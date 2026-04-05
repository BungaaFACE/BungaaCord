import asyncio

from loguru import logger
from datetime import datetime, timezone, timedelta
from aiohttp import web, WSMsgType
import json

from database import db

# Хранилище комнат и подключений
rooms = {}  # room_name -> set of WebSocket connections
connections = {}  # ws -> {"room": room_name, "username": username, "user_uuid": user_uuid}
rooms_user_statuses = {}
user_last_room = {}  # user_uuid -> {"room": room_name, "username": username, "time": timestamp} - для восстановления при переподключении
# {"room": {
#   "username": {
#       "user_uuid": user_uuid,
#       "is_mic_muted": is_mic_muted,
#       "is_deafened": is_deafened,
#       "is_streaming": is_streaming
#   }


def get_timestamp_ago(minutes=3):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).timestamp()


async def websocket_handler(request):
    """Обработчик WebSocket соединений для сигнализации"""
    user_uuid = request.query.get("user", None)
    user = db.get_user_by_uuid(user_uuid)
    username = user["username"]
    room_name = None

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Проверяем, был ли пользователь в комнате до разрыва соединения
    previous_room_data = user_last_room.get(user_uuid)

    connections[ws] = {"room": None, "username": username, "user_uuid": user_uuid}
    logger.info(f"✓ Новое WebSocket соединение добавлено в чат: {username}")

    # Отправляем текущие данные по юзерам в комнатах
    await ws.send_json({"type": "user_status_total", "data": rooms_user_statuses})

    # Если пользователь был в комнате не раньше 3 минут, автоматически возвращаем его
    if previous_room_data and previous_room_data.get('time', 0) > get_timestamp_ago(minutes=3):
        room_name = previous_room_data["room"]
        if room_name in rooms:
            logger.info(
                f"🔄 Автовосстановление: пользователь {username} возвращается в комнату {room_name}"
            )

            # Добавляем в комнату
            rooms[room_name].add(ws)
            connections[ws]["room"] = room_name

            # Отправляем подтверждение присоединения
            await ws.send_json({"type": "joined", "room": room_name})

            # Уведомляем других участников о возвращении пользователя
            await broadcast_to_room(
                room_name,
                {"type": "peer_joined", "username": username, "user_uuid": user_uuid},
                exclude_ws=ws,
            )

            # Отправляем пользователю список уже подключенных
            peers_in_room = [
                {
                    "username": connections[conn]["username"],
                    "user_uuid": connections[conn].get("user_uuid", ""),
                }
                for conn in rooms[room_name]
                if conn != ws
            ]
            await ws.send_json({"type": "peers", "peers": peers_in_room})

            # Обновляем статус пользователя
            rooms_user_statuses.setdefault(room_name, {})[username] = {
                "user_uuid": user_uuid,
                "is_mic_muted": False,
                "is_deafened": False,
                "is_streaming": False,
            }

            await broadcast_to_server(
                {
                    "type": "user_status_update",
                    "room": room_name,
                    "user_uuid": user_uuid,
                    "username": username,
                    "is_mic_muted": False,
                    "is_deafened": False,
                    "is_streaming": False,
                }
            )

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                message_type = data.get("type")

                if message_type == "pong":
                    continue

                logger.info(f"Пришло сообщение типа {message_type}")

                if message_type == "join":
                    # Пользователь присоединяется к комнате (голосовой чат)
                    room_name = data.get("room")
                    if not room_name:
                        continue

                    # Проверяем, существует ли комната в базе данных
                    if not db.voice_room_exists(room_name):
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": f"Комната '{room_name}' не существует",
                            }
                        )
                        logger.info(
                            f"Пользователь {username} пытался присоединиться к несуществующей комнате '{room_name}'"
                        )
                        continue

                    # Обновляем информацию о комнате
                    connections[ws]["room"] = room_name
                    logger.info(
                        f"✓ Пользователь {username} присоединился к комнате {room_name}"
                    )

                    # Добавляем в комнату
                    if room_name not in rooms:
                        rooms[room_name] = set()
                    rooms[room_name].add(ws)

                    # Сохраняем состояние комнаты для автовосстановления
                    user_last_room[user_uuid] = {
                        "room": room_name,
                        "username": username,
                        "time": datetime.now(timezone.utc).timestamp()
                    }

                    rooms_user_statuses.setdefault(room_name, {})[username] = {
                        "user_uuid": user_uuid,
                        "is_mic_muted": False,
                        "is_deafened": False,
                        "is_streaming": False,
                    }
                    # Отправляем подтверждение присоединения
                    await ws.send_json({"type": "joined", "room": room_name})

                    # Уведомляем других участников о новом пользователе
                    await broadcast_to_room(
                        room_name,
                        {
                            "type": "peer_joined",
                            "username": username,
                            "user_uuid": user_uuid,
                        },
                        exclude_ws=ws,
                    )

                    # Отправляем новому участнику список уже подключенных
                    peers_in_room = [
                        {
                            "username": connections[conn]["username"],
                            "user_uuid": connections[conn].get("user_uuid", ""),
                        }
                        for conn in rooms[room_name]
                        if conn != ws
                    ]
                    await ws.send_json({"type": "peers", "peers": peers_in_room})

                    await broadcast_to_server(
                        {
                            "type": "user_status_update",
                            "room": room_name,
                            "user_uuid": user_uuid,
                            "username": username,
                            "is_mic_muted": False,
                            "is_deafened": False,
                            "is_streaming": False,
                        }
                    )

                elif message_type == "signal":
                    # Пересылка сигнального сообщения конкретному пиру
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    await send_to_target(
                        target_uuid=target_peer,
                        message={
                            "type": "signal",
                            "sender": user_uuid,
                            "data": signal_data,
                        },
                    )

                elif message_type == "user_status_update":
                    # Обновление статуса пользователя (микрофон/звук)
                    current_room = data.get("room", False)
                    is_mic_muted = data.get("is_mic_muted", False)
                    is_deafened = data.get("is_deafened", False)
                    is_streaming = data.get("is_streaming", False)
                    if current_room != room_name:
                        rooms_user_statuses.get(room_name, dict()).pop(username)
                        room_name = current_room
                    if room_name and rooms_user_statuses.get(room_name, dict()).get(
                        username
                    ):
                        rooms_user_statuses[room_name][username].update(
                            {
                                "is_mic_muted": is_mic_muted,
                                "is_deafened": is_deafened,
                                "is_streaming": is_streaming,
                            }
                        )

                        # Рассылаем статус всем участникам комнаты
                        await broadcast_to_server(
                            {
                                "type": "user_status_update",
                                "room": room_name,
                                "user_uuid": user_uuid,
                                "username": username,
                                "is_mic_muted": is_mic_muted,
                                "is_deafened": is_deafened,
                                "is_streaming": is_streaming,
                            }
                        )

                elif message_type == "screen_share_request":
                    target_peer = data.get("target")
                    logger.info("screen_share_request")

                    await send_to_target(
                        target_uuid=target_peer,
                        message={
                            "type": "screen_share_request",
                            "user_uuid": user_uuid,
                        },
                    )

                elif message_type == "screen_share_stop_request":
                    target_peer = data.get("target")
                    logger.info("screen_share_stop_request")

                elif message_type == "screen_share_stop":
                    # Пользователь остановил демонстрацию экрана

                    # Уведомляем всех участников комнаты
                    await broadcast_to_server(
                        {
                            "type": "screen_share_stop",
                            "peer_uuid": user_uuid,
                            "username": username,
                        },
                        exclude_ws=ws,
                    )

                elif message_type == "screen_signal":
                    # Пересылка сигнального сообщения для демонстрации экрана
                    target_peer = data.get("target")
                    signal_data = data.get("data")

                    await send_to_target(
                        target_uuid=target_peer,
                        message={
                            "type": "screen_signal",
                            "sender": user_uuid,
                            "data": signal_data,
                        },
                    )

                elif message_type == "chat_message":
                    # Текстовое сообщение чата (глобальный чат, не зависит от комнаты)
                    message_content = data.get("content")
                    message_type_db = data.get("message_type", "text")

                    if message_content:
                        # Получаем информацию о пользователе из БД
                        user = db.get_user_by_uuid(user_uuid)
                        username = user["username"] if user else "Unknown"

                        # Обновляем информацию о пользователе в соединении
                        if ws in connections:
                            connections[ws]["user_uuid"] = user_uuid
                            connections[ws]["username"] = username
                            logger.info(
                                f"✓ Обновлена информация о пользователе: {username}"
                            )

                        # Для медиа-сообщений не сохраняем в БД, т.к. они уже сохранены при загрузке файла
                        if message_type_db == "media":
                            logger.info(
                                f"Медиа-сообщение получено (уже сохранено при загрузке): {message_content[:50]}..."
                            )
                            # Используем текущее время для сообщения
                            message_datetime = datetime.now(timezone.utc).isoformat()
                        else:
                            # Для текстовых сообщений сохраняем в БД
                            try:
                                message_id = db.add_message(
                                    message_type_db, message_content, user_uuid
                                )
                                logger.info(
                                    f"Сообщение сохранено в БД (ID: {message_id}): {message_content[:50]}..."
                                )
                            except Exception as e:
                                logger.info(f"Ошибка сохранения сообщения: {e}")
                                return

                            # Получаем сохраненное сообщение из БД
                            messages = db.get_recent_messages(1)
                            message_datetime = None
                            if messages and messages[0]["id"] == message_id:
                                message_datetime = messages[0]["datetime"]

                        # Рассылаем сообщение всем подключенным клиентам (глобальный чат)
                        message_to_send = {
                            "type": "chat_message",
                            "content": message_content,
                            "message_type": message_type_db,
                            "user_uuid": user_uuid,
                            "username": username,
                            "datetime": message_datetime
                            or datetime.now(timezone.utc).isoformat(),
                        }

                        # Отправляем всем подключенным WebSocket клиентам
                        sent_count = 0
                        for conn in connections:
                            if not conn.closed:
                                try:
                                    await conn.send_json(message_to_send)
                                    sent_count += 1
                                except Exception as e:
                                    logger.info(f"Ошибка отправки сообщения: {e}")

                        logger.info(
                            f"Сообщение отправлено {sent_count}/{len(connections)} клиентам, username: {username}"
                        )

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
                                    "username": username,
                                },
                                exclude_ws=ws,
                            )
                            await broadcast_to_server(
                                {
                                    "type": "user_status_update",
                                    "room": f"!{room_name}",
                                    "user_uuid": user_uuid,
                                    "username": username,
                                    "is_mic_muted": False,
                                    "is_deafened": False,
                                    "is_streaming": False,
                                }
                            )
                            del rooms_user_statuses[room_name][username]

                        # Сбрасываем комнату в соединении, но сохраняем остальную информацию
                        connections[ws]["room"] = None

                        # Очищаем состояние автовосстановления
                        if user_uuid in user_last_room:
                            del user_last_room[user_uuid]

                        logger.info(
                            f"✓ Пользователь {username} покинул комнату {room_name}"
                        )
                else:
                    logger.info(f"Unrecognized message_type {message_type}")

    except Exception:
        logger.exception("WebSocket error")
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

            if connections.get(ws, dict()).get("room"):
                # Уведомляем о выходе комнату
                await broadcast_to_room(
                    room=connections[ws]["room"],
                    message={
                        "type": "peer_left",
                        "peer_uuid": user_uuid,
                        "username": username,
                    },
                    exclude_ws=ws,
                )
            if (
                room_name
                and rooms_user_statuses.get(room_name)
                and rooms_user_statuses[room_name].get(username)
            ):
                del rooms_user_statuses[room_name][username]
                await broadcast_to_server(
                    {
                        "type": "user_status_update",
                        "room": f"!{room_name}",
                        "user_uuid": user_uuid,
                        "username": username,
                        "is_mic_muted": False,
                        "is_deafened": False,
                        "is_streaming": False,
                    }
                )

            # ВАЖНО: НЕ очищаем user_last_room здесь!
            # Это позволяет автовосстановить комнату при переподключении
            # user_last_room очищается только при явном leave
            if last_user_status := user_last_room.get(user_uuid):
                last_user_status['time'] = datetime.now(timezone.utc).timestamp()
    return ws


async def broadcast_to_server(message, exclude_ws=None):
    """Отправка сообщения всем, кроме исключенного WebSocket"""
    tasks = [
        asyncio.create_task(conn.send_json(message))
        for conn in connections.keys()
        if conn != exclude_ws and not conn.closed
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def broadcast_to_room(room, message, exclude_ws=None):
    """Отправка сообщения всем в комнате, кроме исключенного WebSocket"""
    if room not in rooms:
        return
    tasks = [
        asyncio.create_task(conn.send_json(message))
        for conn in rooms[room]
        if conn != exclude_ws and not conn.closed
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_to_target(target_uuid, message):
    try:
        target_ws = None
        if target_uuid:
            for conn, info in connections.items():
                if info["user_uuid"] == target_uuid:
                    target_ws = conn
                    break
            logger.info(f"target_ws={target_ws}")
            if target_ws is not None:
                await target_ws.send_json(message)
            else:
                logger.bind(target_uuid=target_uuid, connections=connections).warning(
                    "Target WS not found!"
                )

    except Exception:
        logger.bind(target_uuid=target_uuid, target_ws=target_ws).exception(
            "send_to_target exception"
        )


async def _cleanup_connection(ws):
    pass


async def send_periodic_message():
    """Отправка периодического сообщения всем подключенным WebSocket клиентам"""
    message = {"type": "ping"}
    while True:
        await asyncio.sleep(25)  # Ждем 25 секунд

        # Отправляем сообщение всем подключенным WebSocket клиентам
        for ws in list(connections.keys()):
            if not ws.closed:
                try:
                    await ws.send_json(message)
                    continue
                except Exception as e:
                    logger.info(f"Ошибка отправки периодического сообщения: {e}")
            if ws in connections:
                connections.pop(ws)
