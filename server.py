# server.py
import asyncio
import json
import logging
import os
import ssl
from datetime import datetime
from aiohttp import web, WSMsgType
from dotenv import load_dotenv
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
    upload_media
)

HOST = '0.0.0.0'
PORT = '9000'
MAX_MESSAGES = 20

# Хранилище комнат и подключений
rooms = {}  # room_name -> set of WebSocket connections
connections = {}  # ws -> {"room": room_name, "peer_id": peer_id}


async def websocket_handler(request):
    """Обработчик WebSocket соединений для сигнализации"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    peer_id = None
    room_name = None
    user_uuid = None
    username = None

    # Сразу добавляем соединение в словарь (для глобального чата)
    # Генерируем временный peer_id для чата
    import uuid as uuid_lib
    temp_peer_id = 'chat_' + uuid_lib.uuid4().hex[:12]
    connections[ws] = {
        "room": None,
        "peer_id": temp_peer_id,
        "username": "Unknown",
        "user_uuid": None
    }
    print(f"✓ Новое WebSocket соединение добавлено в чат: {temp_peer_id}")

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                message_type = data.get("type")

                if message_type == "join":
                    # Пользователь присоединяется к комнате (голосовой чат)
                    peer_id = data.get("peer_id")
                    room_name = data.get("room")
                    user_uuid = data.get("user_uuid")

                    # Получаем username из данных, если он не передан или пустой - получаем из БД
                    username = data.get("username", "")
                    if not username and user_uuid:
                        user = db.get_user_by_uuid(user_uuid)
                        if user:
                            username = user['username']
                        else:
                            username = peer_id  # fallback

                    if not peer_id or not room_name or not user_uuid:
                        continue

                    # Проверяем, существует ли комната в базе данных
                    if not db.voice_room_exists(room_name):
                        await ws.send_json({
                            "type": "error",
                            "message": f"Комната '{room_name}' не существует"
                        })
                        print(f"❌ Пользователь {username} пытался присоединиться к несуществующей комнате '{room_name}'")
                        continue

                    # Обновляем информацию о подключении
                    connections[ws] = {
                        "room": room_name,
                        "peer_id": peer_id,
                        "username": username,
                        "user_uuid": user_uuid
                    }
                    print(f"✓ Пользователь {username} присоединился к комнате {room_name}")

                    # Добавляем в комнату
                    if room_name not in rooms:
                        rooms[room_name] = set()
                    rooms[room_name].add(ws)

                    # Отправляем подтверждение присоединения
                    await ws.send_json({
                        "type": "joined",
                        "room": room_name,
                        "peer_id": peer_id,
                        "username": username,
                        "user_uuid": user_uuid
                    })

                    # Уведомляем других участников о новом пользователе
                    await broadcast_to_room(room_name, ws, {
                        "type": "peer_joined",
                        "peer_id": peer_id,
                        "username": username,
                        "user_uuid": user_uuid
                    })

                    # Отправляем новому участнику список уже подключенных
                    peers_in_room = [
                        {
                            "peer_id": connections[conn]["peer_id"],
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

                elif message_type == "signal":
                    # Пересылка сигнального сообщения конкретному пиру
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    if target_peer:
                        # Ищем WebSocket целевого пира
                        target_ws = None
                        for conn, info in connections.items():
                            if info["peer_id"] == target_peer:
                                target_ws = conn
                                break

                        if target_ws:
                            await target_ws.send_json({
                                "type": "signal",
                                "sender": peer_id,
                                "data": signal_data
                            })

                elif message_type == "user_status":
                    # Обновление статуса пользователя (микрофон/звук)
                    is_mic_muted = data.get("is_mic_muted", False)
                    is_deafened = data.get("is_deafened", False)

                    # Рассылаем статус всем участникам комнаты
                    await broadcast_to_room(room_name, None, {
                        "type": "peer_status_update",
                        "peer_id": peer_id,
                        "username": connections[ws]["username"],
                        "is_mic_muted": is_mic_muted,
                        "is_deafened": is_deafened
                    })

                elif message_type == "screen_share_start":
                    # Пользователь начал демонстрацию экрана
                    peer_id = data.get("peer_id")
                    username = data.get("username", peer_id)
                    room_name = connections[ws]["room"] if ws in connections else None

                    # Проверяем, что пользователь в valid комнате
                    if not room_name or not db.voice_room_exists(room_name):
                        await ws.send_json({
                            "type": "error",
                            "message": "Нельзя начать демонстрацию экрана: комната не существует"
                        })
                        continue

                    # Уведомляем всех участников комнаты
                    await broadcast_to_room(room_name, ws, {
                        "type": "screen_share_start",
                        "peer_id": peer_id,
                        "username": username
                    })

                elif message_type == "screen_share_stop":
                    # Пользователь остановил демонстрацию экрана
                    peer_id = data.get("peer_id")
                    username = data.get("username", peer_id)

                    # Уведомляем всех участников комнаты
                    await broadcast_to_room(room_name, ws, {
                        "type": "screen_share_stop",
                        "peer_id": peer_id,
                        "username": username
                    })

                elif message_type == "screen_signal":
                    # Пересылка сигнального сообщения для демонстрации экрана
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    if target_peer:
                        # Ищем WebSocket целевого пира
                        target_ws = None
                        for conn, info in connections.items():
                            if info["peer_id"] == target_peer:
                                target_ws = conn
                                break

                        if target_ws:
                            await target_ws.send_json({
                                "type": "screen_signal",
                                "sender": peer_id,
                                "data": signal_data
                            })

                elif message_type == "chat_message":
                    # Текстовое сообщение чата (глобальный чат, не зависит от комнаты)
                    message_content = data.get("content")
                    message_type_db = data.get("message_type", "text")
                    user_uuid = data.get("user_uuid")

                    if message_content:
                        # Получаем информацию о пользователе из БД
                        user = db.get_user_by_uuid(user_uuid)
                        username = user['username'] if user else "Unknown"

                        # Обновляем информацию о пользователе в соединении
                        if ws in connections:
                            connections[ws]["user_uuid"] = user_uuid
                            connections[ws]["username"] = username
                            print(f"✓ Обновлена информация о пользователе: {username}")

                        # Для медиа-сообщений не сохраняем в БД, т.к. они уже сохранены при загрузке файла
                        if message_type_db == 'media':
                            print(f"📸 Медиа-сообщение получено (уже сохранено при загрузке): {message_content[:50]}...")
                            # Используем текущее время для сообщения
                            message_datetime = datetime.now().isoformat()
                        else:
                            # Для текстовых сообщений сохраняем в БД
                            try:
                                message_id = db.add_message(message_type_db, message_content, user_uuid)
                                print(f"💬 Сообщение сохранено в БД (ID: {message_id}): {message_content[:50]}...")
                            except Exception as e:
                                print(f"❌ Ошибка сохранения сообщения: {e}")
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
                            "datetime": message_datetime or datetime.now().isoformat()
                        }

                        # Отправляем всем подключенным WebSocket клиентам
                        sent_count = 0
                        for conn in connections:
                            if not conn.closed:
                                try:
                                    await conn.send_json(message_to_send)
                                    sent_count += 1
                                except Exception as e:
                                    print(f'Ошибка отправки сообщения: {e}')

                        print(f"📤 Сообщение отправлено {sent_count}/{len(connections)} клиентам, username: {username}")

                elif message_type == "leave":
                    # Пользователь покидает комнату
                    if ws in connections:
                        room_name = connections[ws]["room"]
                        peer_id = connections[ws]["peer_id"]
                        username = connections[ws]["username"]

                        # Удаляем из комнаты
                        if room_name in rooms and ws in rooms[room_name]:
                            rooms[room_name].remove(ws)
                            if not rooms[room_name]:
                                del rooms[room_name]

                        # Уведомляем других участников
                        if room_name:
                            await broadcast_to_room(room_name, None, {
                                "type": "peer_left",
                                "peer_id": peer_id,
                                "username": username
                            })

                        # Сбрасываем комнату в соединении, но сохраняем остальную информацию
                        connections[ws]["room"] = None
                        print(f"✓ Пользователь {username} покинул комнату {room_name}")

    except Exception as e:
        logging.error(f"WebSocket error: {e}")
    finally:
        # Очистка при отключении
        if ws in connections:
            info = connections.pop(ws)
            room_name = info["room"]
            peer_id = info["peer_id"]
            username = info["username"]

            if room_name in rooms and ws in rooms[room_name]:
                rooms[room_name].remove(ws)
                if not rooms[room_name]:
                    del rooms[room_name]

            # Уведомляем о выходе
            await broadcast_to_room(room_name, None, {
                "type": "peer_left",
                "peer_id": peer_id,
                "username": username
            })

    return ws


async def broadcast_to_room(room_name, exclude_ws, message):
    """Отправка сообщения всем в комнате, кроме исключенного WebSocket"""
    if room_name in rooms:
        for conn in rooms[room_name]:
            if conn != exclude_ws and not conn.closed:
                try:
                    await conn.send_json(message)
                except:
                    pass


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


async def main():
    """Основная функция запуска сервера"""

    # Загружаем переменные окружения из .env файла
    load_dotenv()
    print("✅ Переменные окружения загружены из .env файла")

    # Инициализируем базу данных
    db.connect()
    db.init_tables()
    db.init_default_rooms()  # Инициализируем комнаты по умолчанию
    db.MAX_MESSAGES = MAX_MESSAGES
    print("✅ База данных SQLite инициализирована")

    # Добавляем администратора из переменных окружения
    admin_uuid = os.getenv('ADMIN_UUID')
    admin_username = os.getenv('ADMIN_USERNAME')

    if admin_uuid and admin_username:
        db.add_admin_user(admin_uuid, admin_username)
    else:
        print("⚠️  Переменные ADMIN_UUID и/или ADMIN_USERNAME не найдены в .env файле")

    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.check_hostname = False
    ssl_context.load_cert_chain('cert.pem', 'key.pem')

    main_app = web.Application()

    # Настройка маршрутов
    main_app.router.add_get('/ws', websocket_handler)
    main_app.router.add_get('/', index_handler)

    main_app.router.add_static('/static/', path='./static', name='static')

    # API SECTION
    api_app = web.Application(middlewares=[is_user_middleware])
    api_app.router.add_get('/messages', get_messages)
    api_app.router.add_get('/user', get_current_user)
    api_app.router.add_get('/rooms', get_voice_rooms)
    api_app.router.add_post('/upload', upload_media)
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
    site = web.TCPSite(runner, HOST, PORT, ssl_context=ssl_context)

    if HOST == '0.0.0.0':
        import psutil
        import socket
        addresses = psutil.net_if_addrs()
        for interface, snics in addresses.items():
            for snic in snics:
                # Filter for IPv4 addresses (socket.AF_INET)
                if snic.family == socket.AF_INET:
                    print(f"🚀 Сервер запущен на https://{snic.address}:{PORT}/?user={admin_uuid}")
                    print(f"🚀 Сервер запущен на https://{snic.address}:{PORT}/admin/panel?user={admin_uuid}")
    else:
        print(f"🚀 Сервер запущен на https://{HOST}:{PORT}")

    print(f"📊 Максимальное количество сообщений: {MAX_MESSAGES}")

    await site.start()

    # Бесконечное ожидание
    try:
        await asyncio.Future()
    finally:
        # Закрываем соединение с базой данных при завершении
        db.close()
        print("✅ Соединение с базой данных закрыто")

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
