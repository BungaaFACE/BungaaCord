# server.py
import ssl
import json
import asyncio
from loguru import logger
from datetime import datetime, timezone
from aiohttp import web, WSMsgType
from config import ADMIN_UUID, ADMIN_USERNAME, PROTOCOL, HOST, PORT, MAX_CHAT_MESSAGES
from database import db
from handlers.middlewares import is_admin_middleware, is_user_middleware
from handlers.admin_handlers import (
    admin_handler,
    create_user,
    delete_user,
    get_all_users
)
from handlers.api_handlers import (
    get_current_user,
    get_messages,
    get_voice_rooms,
    upload_media,
    get_turn_creds,
    upload_avatar
)


# Хранилище комнат и подключений
rooms = {}  # room_name -> set of WebSocket connections
connections = {}  # ws -> {"room": room_name, "username": username, "user_uuid": user_uuid}
rooms_user_statuses = {}
# {"room": {
#   "username": {
#       "user_uuid": user_uuid,
#       "is_mic_muted": is_mic_muted,
#       "is_deafened": is_deafened,
#       "is_streaming": is_streaming
#       "streaming_to": []}, ...}}
wait_for_room_reconnect = {}
#       {user_uuid:
#           {"room_name": room_name,
#           "is_mic_muted": is_mic_muted,
#           "is_deafened": is_deafened,
#           "is_streaming": is_streaming,
#           "streaming_to": [uuid1, uuid2]}, ...}


async def websocket_handler(request):
    """Обработчик WebSocket соединений для сигнализации"""
    user_uuid = request.query.get('user', None)
    user = db.get_user_by_uuid(user_uuid)
    username = user['username']
    room_name = None

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    connections[ws] = {
        "room": None,
        "username": username,
        "user_uuid": user_uuid
    }
    logger.info(f"✓ Новое WebSocket соединение добавлено в чат: {username}")

    #####################################################################################################
    # Trying to reconnect user to room and reconnect all webrtc connections and screensharing connections
    if user_uuid in wait_for_room_reconnect:
        reconnect_user_info = wait_for_room_reconnect.pop(user_uuid)
        room_name = reconnect_user_info["room_name"]
        rooms[room_name].add(ws)
        connections[ws]["room"] = room_name
        if room_name not in rooms_user_statuses:
            rooms_user_statuses[room_name] = {}
        rooms_user_statuses[room_name][username] = {
            "user_uuid": user_uuid,
            "is_mic_muted": reconnect_user_info["is_mic_muted"],
            "is_deafened": reconnect_user_info["is_deafened"],
            "is_streaming": reconnect_user_info["is_streaming"],
            "streaming_to": reconnect_user_info["streaming_to"]
        }
        await broadcast_to_room(
            room_name,
            {"type": "peer_joined",
                "username": username,
                "user_uuid": user_uuid},
            exclude_ws=ws
        )

        peers_in_room = [
            {
                "username": connections[conn]["username"],
                "user_uuid": connections[conn].get("user_uuid", "")
            }
            for conn in rooms[room_name]
            if conn != ws
        ]
        await ws.send_json({
            "type": "peers",
            "peers": peers_in_room
        })
        for streaming_to_uuid in reconnect_user_info["streaming_to"]:
            await ws.send_json({
                "type": "screen_share_request",
                "user_uuid": streaming_to_uuid
            })
        #################################################################################

    # Отправляем текущие данные по юзерам в комнатах
    await ws.send_json({"type": "user_status_total", "data": rooms_user_statuses})

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                message_type = data.get("type")

                if message_type == 'pong':
                    continue

                logger.info(f'Пришло сообщение типа {message_type}')

                if message_type == "join":
                    # Пользователь присоединяется к комнате (голосовой чат)
                    room_name = data.get("room")
                    if not room_name:
                        continue

                    # Проверяем, существует ли комната в базе данных
                    if not db.voice_room_exists(room_name):
                        await ws.send_json({
                            "type": "error",
                            "message": f"Комната '{room_name}' не существует"
                        })
                        logger.info(f"Пользователь {username} пытался присоединиться к несуществующей комнате '{room_name}'")
                        continue

                    # Обновляем информацию о комнате
                    connections[ws]['room'] = room_name
                    logger.info(f"✓ Пользователь {username} присоединился к комнате {room_name}")

                    # Добавляем в комнату
                    if room_name not in rooms:
                        rooms[room_name] = set()
                    rooms[room_name].add(ws)

                    rooms_user_statuses.setdefault(room_name, {})[username] = {"user_uuid": user_uuid,
                                                                               "is_mic_muted": False,
                                                                               "is_deafened": False,
                                                                               "is_streaming": False,
                                                                               "streaming_to": []}

                    # Отправляем подтверждение присоединения
                    await ws.send_json({
                        "type": "joined",
                        "room": room_name
                    })

                    # Уведомляем других участников о новом пользователе
                    await broadcast_to_room(
                        room_name,
                        {"type": "peer_joined",
                         "username": username,
                         "user_uuid": user_uuid},
                        exclude_ws=ws
                    )

                    # Отправляем новому участнику список уже подключенных
                    peers_in_room = [
                        {
                            "username": connections[conn]["username"],
                            "user_uuid": connections[conn].get("user_uuid", "")
                        }
                        for conn in rooms[room_name]
                        if conn != ws
                    ]
                    await ws.send_json({
                        "type": "peers",
                        "peers": peers_in_room
                    })

                    await broadcast_to_server({
                        "type": "user_status_update",
                        "room": room_name,
                        "user_uuid": user_uuid,
                        "username": username,
                        "is_mic_muted": False,
                        "is_deafened": False,
                        "is_streaming": False
                    })

                elif message_type == "signal":
                    # Пересылка сигнального сообщения конкретному пиру
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    await send_to_target(
                        taget_uuid=target_peer,
                        message={
                            "type": "signal",
                            "sender": user_uuid,
                            "data": signal_data
                        }
                    )

                elif message_type == "user_status_update":
                    # Обновление статуса пользователя (микрофон/звук)
                    is_mic_muted = data.get("is_mic_muted", False)
                    is_deafened = data.get("is_deafened", False)
                    is_streaming = data.get("is_streaming", False)
                    if room_name and rooms_user_statuses.get(room_name, dict()).get(username):
                        rooms_user_statuses[room_name][username].update({
                            "is_mic_muted": is_mic_muted,
                            "is_deafened": is_deafened,
                            "is_streaming": is_streaming
                        })
                        if not is_streaming:
                            rooms_user_statuses[room_name][username]["streaming_to"].clear()

                        # Рассылаем статус всем участникам комнаты
                        await broadcast_to_server({
                            "type": "user_status_update",
                            "room": room_name,
                            "user_uuid": user_uuid,
                            "username": username,
                            "is_mic_muted": is_mic_muted,
                            "is_deafened": is_deafened,
                            "is_streaming": is_streaming
                        })

                elif message_type == "screen_share_request":
                    target_peer = data.get("target")
                    logger.info('screen_share_request')

                    await send_to_target(
                        taget_uuid=target_peer,
                        message={
                            "type": "screen_share_request",
                            "user_uuid": user_uuid
                        }
                    )
                    for conn_info in connections.values():
                        if conn_info["user_uuid"] == target_peer:
                            rooms_user_statuses[conn_info['room']][conn_info["username"]]["streaming_to"].append(user_uuid)
                            break

                elif message_type == "screen_share_stop_request":
                    target_peer = data.get("target")
                    logger.info('screen_share_stop_request')

                    for conn_info in connections.values():
                        if conn_info["user_uuid"] == target_peer:
                            rooms_user_statuses[conn_info["room"]][conn_info["username"]]["streaming_to"].remove(user_uuid)
                            break

                elif message_type == "screen_share_stop":
                    # Пользователь остановил демонстрацию экрана

                    # Уведомляем всех участников комнаты
                    await broadcast_to_server(
                        {
                            "type": "screen_share_stop",
                            "peer_uuid": user_uuid,
                            "username": username
                        },
                        exclude_ws=ws
                    )

                elif message_type == "screen_signal":
                    # Пересылка сигнального сообщения для демонстрации экрана
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    await send_to_target(
                        taget_uuid=target_peer,
                        message={
                            "type": "screen_signal",
                            "sender": user_uuid,
                            "data": signal_data
                        }
                    )

                elif message_type == "chat_message":
                    # Текстовое сообщение чата (глобальный чат, не зависит от комнаты)
                    message_content = data.get("content")
                    message_type_db = data.get("message_type", "text")

                    if message_content:
                        # Получаем информацию о пользователе из БД
                        user = db.get_user_by_uuid(user_uuid)
                        username = user['username'] if user else "Unknown"

                        # Обновляем информацию о пользователе в соединении
                        if ws in connections:
                            connections[ws]["user_uuid"] = user_uuid
                            connections[ws]["username"] = username
                            logger.info(f"✓ Обновлена информация о пользователе: {username}")

                        # Для медиа-сообщений не сохраняем в БД, т.к. они уже сохранены при загрузке файла
                        if message_type_db == 'media':
                            logger.info(f"Медиа-сообщение получено (уже сохранено при загрузке): {message_content[:50]}...")
                            # Используем текущее время для сообщения
                            message_datetime = datetime.now(timezone.utc).isoformat()
                        else:
                            # Для текстовых сообщений сохраняем в БД
                            try:
                                message_id = db.add_message(message_type_db, message_content, user_uuid)
                                logger.info(f"Сообщение сохранено в БД (ID: {message_id}): {message_content[:50]}...")
                            except Exception as e:
                                logger.info(f"Ошибка сохранения сообщения: {e}")
                                return

                            # Получаем сохраненное сообщение из БД
                            messages = db.get_recent_messages(1)
                            message_datetime = None
                            if messages and messages[0]['id'] == message_id:
                                message_datetime = messages[0]['datetime']

                        # Рассылаем сообщение всем подключенным клиентам (глобальный чат)
                        message_to_send = {
                            "type": "chat_message",
                            "content": message_content,
                            "message_type": message_type_db,
                            "user_uuid": user_uuid,
                            "username": username,
                            "datetime": message_datetime or datetime.now(timezone.utc).isoformat()
                        }

                        # Отправляем всем подключенным WebSocket клиентам
                        sent_count = 0
                        for conn in connections:
                            if not conn.closed:
                                try:
                                    await conn.send_json(message_to_send)
                                    sent_count += 1
                                except Exception as e:
                                    logger.info(f'Ошибка отправки сообщения: {e}')

                        logger.info(f"Сообщение отправлено {sent_count}/{len(connections)} клиентам, username: {username}")

                elif message_type == "leave":
                    # Пользователь покидает комнату
                    if ws in connections:
                        room_name = connections[ws]["room"]

                        # Удаляем из комнаты
                        if room_name in rooms and ws in rooms[room_name]:
                            rooms[room_name].remove(ws)
                            if not rooms[room_name]:
                                del rooms[room_name]

                        # Уведомляем других участников
                        if room_name:
                            await broadcast_to_room(
                                room=room_name,
                                message={
                                    "type": "peer_left",
                                    "peer_uuid": user_uuid,
                                    "username": username
                                },
                                exclude_ws=ws
                            )
                            await broadcast_to_server({
                                "type": "user_status_update",
                                "room": f'!{room_name}',
                                "user_uuid": user_uuid,
                                "username": username,
                                "is_mic_muted": False,
                                "is_deafened": False,
                                "is_streaming": False
                            })
                            del rooms_user_statuses[room_name][username]

                        # Сбрасываем комнату в соединении, но сохраняем остальную информацию
                        connections[ws]["room"] = None

                        logger.info(f"✓ Пользователь {username} покинул комнату {room_name}")
                else:
                    logger.info(f'Unrecognized message_type {message_type}')

    except Exception as e:
        logger.exception(f"WebSocket error")
        if connections.get(ws, dict()).get('room'):
            wait_for_room_reconnect[user_uuid] = {
                "room_name": connections[ws]["room"],
                "is_mic_muted": rooms_user_statuses[username]["is_mic_muted"],
                "is_deafened": rooms_user_statuses[username]["is_deafened"],
                "is_streaming": rooms_user_statuses[username]["is_streaming"],
                "streaming_to": rooms_user_statuses[username]["streaming_to"]

            }
    finally:
        # Очистка при отключении
        if ws in connections:
            info = connections.pop(ws)
            room_name = info["room"]
            username = info["username"]

            if room_name in rooms and ws in rooms[room_name]:
                rooms[room_name].remove(ws)
                if not rooms[room_name]:
                    del rooms[room_name]

            if connections.get(ws, dict()).get('room'):
                # Уведомляем о выходе комнату
                await broadcast_to_room(
                    room=connections[ws]['room'],
                    message={
                        "type": "peer_left",
                        "peer_uuid": user_uuid,
                        "username": username
                    },
                    exclude_ws=ws
                )
            if room_name and rooms_user_statuses.get(room_name) and rooms_user_statuses[room_name].get(username):
                del rooms_user_statuses[room_name][username]
                await broadcast_to_server({
                    "type": "user_status_update",
                    "room": f'!{room_name}',
                    "user_uuid": user_uuid,
                    "username": username,
                    "is_mic_muted": False,
                    "is_deafened": False,
                    "is_streaming": False
                })
        await asyncio.sleep(10)
        if user_uuid in wait_for_room_reconnect:
            wait_for_room_reconnect.pop(user_uuid, None)
    return ws


async def broadcast_to_server(message, exclude_ws=None):
    """Отправка сообщения всем, кроме исключенного WebSocket"""
    for conn in connections.keys():
        if conn != exclude_ws and not conn.closed:
            try:
                await conn.send_json(message)
            except:
                pass


async def broadcast_to_room(room, message, exclude_ws=None):
    """Отправка сообщения всем в комнате, кроме исключенного WebSocket"""
    for conn in rooms.get(room, set()):
        if conn != exclude_ws and not conn.closed:
            try:
                await conn.send_json(message)
            except:
                pass


async def send_to_target(taget_uuid, message):
    try:
        target_ws = None
        if taget_uuid:
            for conn, info in connections.items():
                if info["user_uuid"] == taget_uuid:
                    target_ws = conn
                    break
            logger.info(f'target_ws={target_ws}')
            if target_ws is not None:
                await target_ws.send_json(message)
            else:
                logger.bind(taget_uuid=taget_uuid, connections=connections).warning('Target WS not found!')

    except Exception:
        logger.bind(taget_uuid=taget_uuid, target_ws=target_ws).exception('send_to_target exception')


async def index_handler(request):
    """Отдача статического HTML файла только при наличии valid UUID"""
    # Получаем параметр user из query string
    user_uuid = request.query.get('user', None)

    if not user_uuid:
        # Если параметр отсутствует, возвращаем 404
        return web.HTTPNotFound()

    # Проверяем, существует ли пользователь с таким UUID в базе данных
    user = db.get_user_by_uuid(user_uuid)

    if not user:
        # Если пользователь не найден, возвращаем 404
        return web.HTTPNotFound()

    # Если пользователь существует, отдаем страницу
    return web.FileResponse('./templates/index.html')


async def favicon(request):
    return web.FileResponse('./static/favicon.ico')


async def main():
    """Основная функция запуска сервера"""
    asyncio.create_task(send_periodic_message())

    # Инициализируем базу данных
    db.connect()
    db.init_tables()
    db.init_default_rooms()  # Инициализируем комнаты по умолчанию
    logger.info("База данных SQLite инициализирована")

    # Добавляем администратора из переменных окружения
    admin_uuid = ADMIN_UUID
    admin_username = ADMIN_USERNAME

    if admin_uuid and admin_username:
        db.add_admin_user(admin_uuid, admin_username)
    else:
        logger.info("Переменные ADMIN_UUID и/или ADMIN_USERNAME не найдены в .env файле")

    ssl_params = {}
    if PROTOCOL == 'https':
        ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_context.check_hostname = False
        ssl_context.load_cert_chain('cert.pem', 'key.pem')
        ssl_params['ssl_context'] = ssl_context

    main_app = web.Application()

    # Настройка маршрутов
    main_app.router.add_get('/ws', websocket_handler)
    main_app.router.add_get('/', index_handler)
    main_app.router.add_get('/favicon.ico', favicon)

    main_app.router.add_static('/static/', path='./static', name='static')

    # API SECTION
    api_app = web.Application(middlewares=[is_user_middleware])
    api_app.router.add_get('/messages', get_messages)
    api_app.router.add_get('/user', get_current_user)
    api_app.router.add_get('/rooms', get_voice_rooms)
    api_app.router.add_post('/upload', upload_media)
    api_app.router.add_post('/upload_avatar', upload_avatar)
    api_app.router.add_get('/get_turn_creds', get_turn_creds)
    main_app.add_subapp('/api/', api_app)

    # ADMIN SECTION
    admin_app = web.Application(middlewares=[is_admin_middleware])
    admin_app.router.add_get('/panel', admin_handler)
    admin_app.router.add_get('/api/users', get_all_users)
    admin_app.router.add_post('/api/users', create_user)
    admin_app.router.add_delete('/api/users', delete_user)
    main_app.add_subapp('/admin/', admin_app)

    # Запуск сервера
    runner = web.AppRunner(main_app)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT, **ssl_params)

    if HOST == '0.0.0.0':
        import psutil
        import socket
        addresses = psutil.net_if_addrs()
        for interface, snics in addresses.items():
            for snic in snics:
                # Filter for IPv4 addresses (socket.AF_INET)
                if snic.family == socket.AF_INET:
                    logger.info(f"Сервер запущен на {PROTOCOL}://{snic.address}:{PORT}/?user={admin_uuid}")
                    logger.info(
                        f"Админская панель запущена на {PROTOCOL}://{snic.address}:{PORT}/admin/panel?user={admin_uuid}")
    else:
        logger.info(f"Сервер запущен на {PROTOCOL}://{HOST}:{PORT}/?user={admin_uuid}")
        logger.info(f"Админская панель запущена на {PROTOCOL}://{HOST}:{PORT}/admin/panel?user={admin_uuid}")

    logger.info(f"Максимальное количество сообщений: {MAX_CHAT_MESSAGES}")

    await site.start()

    # Бесконечное ожидание
    try:
        await asyncio.Future()
    finally:
        # Закрываем соединение с базой данных при завершении
        db.close()
        logger.info("Соединение с базой данных закрыто")


async def send_periodic_message():
    """Отправка периодического сообщения всем подключенным WebSocket клиентам"""
    message = {
        "type": "ping"
    }
    while True:
        await asyncio.sleep(25)  # Ждем 25 секунд

        # Отправляем сообщение всем подключенным WebSocket клиентам
        for ws in list(connections.keys()):
            if not ws.closed:
                try:
                    await ws.send_json(message)
                    continue
                except Exception as e:
                    logger.info(f'Ошибка отправки периодического сообщения: {e}')
            if ws in connections:
                connections.pop(ws)


if __name__ == '__main__':
    asyncio.run(main())
