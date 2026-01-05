# server.py
import asyncio
import json
import logging
import ssl
from aiohttp import web, WSMsgType

HOST = '0.0.0.0'
PORT = '9000'

# Хранилище комнат и подключений
rooms = {}  # room_name -> set of WebSocket connections
connections = {}  # ws -> {"room": room_name, "peer_id": peer_id}


async def websocket_handler(request):
    """Обработчик WebSocket соединений для сигнализации"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    peer_id = None
    room_name = None

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                message_type = data.get("type")

                if message_type == "join":
                    # Пользователь присоединяется к комнате
                    peer_id = data.get("peer_id")
                    room_name = data.get("room")
                    username = data.get("username", peer_id)

                    if not peer_id or not room_name:
                        continue

                    # Сохраняем информацию о подключении
                    connections[ws] = {
                        "room": room_name,
                        "peer_id": peer_id,
                        "username": username
                    }

                    # Добавляем в комнату
                    if room_name not in rooms:
                        rooms[room_name] = set()
                    rooms[room_name].add(ws)

                    # Отправляем подтверждение присоединения
                    await ws.send_json({
                        "type": "joined",
                        "room": room_name,
                        "peer_id": peer_id,
                        "username": username
                    })

                    # Уведомляем других участников о новом пользователе
                    await broadcast_to_room(room_name, ws, {
                        "type": "peer_joined",
                        "peer_id": peer_id,
                        "username": username
                    })

                    # Отправляем новому участнику список уже подключенных
                    peers_in_room = [
                        {"peer_id": connections[conn]["peer_id"],
                         "username": connections[conn]["username"]}
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
                        await broadcast_to_room(room_name, None, {
                            "type": "peer_left",
                            "peer_id": peer_id,
                            "username": username
                        })

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
    """Отдача статического HTML файла"""
    return web.FileResponse('./templates/index.html')


async def health_check(request):
    """Проверка здоровья сервера"""
    return web.json_response({"status": "ok", "rooms": len(rooms)})


async def main():
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.check_hostname = False
    ssl_context.load_cert_chain('cert.pem', 'key.pem')
    """Основная функция запуска сервера"""
    app = web.Application()

    # Настройка маршрутов
    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/', index_handler)
    app.router.add_get('/health', health_check)
    app.router.add_static('/static/', path='./static', name='static')

    # Запуск сервера
    runner = web.AppRunner(app)
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
                    print(f"🚀 Сервер запущен на https://{snic.address}:{PORT}")
    else:
        print(f"🚀 Сервер запущен на https://{HOST}:{PORT}")

    await site.start()

    # Бесконечное ожидание
    await asyncio.Future()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
