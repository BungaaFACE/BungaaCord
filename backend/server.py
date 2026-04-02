# server.py
import ssl
import asyncio
from loguru import logger
from aiohttp import web

from config import ADMIN_UUID, ADMIN_USERNAME, CERT_FILEPATH, CURRENT_DIR, KEY_FILEPATH, PROTOCOL, HOST, PORT, MAX_CHAT_MESSAGES
from database import db
from handlers.middlewares import is_admin_middleware, is_user_middleware, cors_middleware
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
from handlers.websocket import websocket_handler, send_periodic_message


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
        ssl_context.load_cert_chain(CERT_FILEPATH, KEY_FILEPATH)
        ssl_params['ssl_context'] = ssl_context

    main_app = web.Application(middlewares=[cors_middleware])

    # Настройка маршрутов
    main_app.router.add_get('/ws', websocket_handler)
    main_app.router.add_static('/static/', path=f'{CURRENT_DIR}/static', name='static')

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
    logger.info(f"Максимальное количество сообщений: {MAX_CHAT_MESSAGES}")

    await site.start()

    # Бесконечное ожидание
    try:
        await asyncio.Future()
    finally:
        # Закрываем соединение с базой данных при завершении
        db.close()
        logger.info("Соединение с базой данных закрыто")


if __name__ == '__main__':
    asyncio.run(main())
