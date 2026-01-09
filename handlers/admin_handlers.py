from aiohttp import web
from database import db


async def admin_handler(request):
    """Обработчик страницы администрирования"""
    return web.FileResponse('./templates/admin.html')


async def get_all_users(request):
    """Получить список всех пользователей (только для админов)"""
    try:
        if not db.conn:
            db.connect()

        cursor = db.conn.cursor()
        cursor.execute('SELECT uuid, username, is_admin FROM Users ORDER BY username')
        rows = cursor.fetchall()

        users = [dict(row) for row in rows]

        return web.json_response({
            "status": "ok",
            "users": users
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def create_user(request):
    """Создать нового пользователя (только для админов)"""
    try:
        data = await request.json()

        username = data.get('username', '').strip()
        uuid = data.get('uuid', '').strip()
        is_admin = bool(data.get('is_admin', False))

        if not username:
            return web.json_response({
                "status": "error",
                "error": "Username is required"
            }, status=400)

        if not uuid:
            return web.json_response({
                "status": "error",
                "error": "UUID is required"
            }, status=400)

        # Создаем пользователя
        success = db.add_user(uuid, username, is_admin)

        if success:
            return web.json_response({
                "status": "ok",
                "message": "User created successfully",
                "user": {
                    "uuid": uuid,
                    "username": username,
                    "is_admin": is_admin
                }
            })
        else:
            return web.json_response({
                "status": "error",
                "error": "User already exists"
            }, status=400)

    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def delete_user(request):
    """Удалить пользователя (только для админов)"""
    try:
        # Читаем UUID админа
        admin_uuid = request.query.get('user', None)
        # Читаем UUID пользователя для удаления из query параметров
        user_uuid = request.query.get('uuid', None)

        if not user_uuid:
            return web.json_response({
                "status": "error",
                "error": "User UUID is required"
            }, status=400)

        # Нельзя удалить самого себя
        if user_uuid == admin_uuid:
            return web.json_response({
                "status": "error",
                "error": "Cannot delete yourself"
            }, status=400)

        # Удаляем пользователя
        success = db.delete_user(user_uuid)

        if success:
            return web.json_response({
                "status": "ok",
                "message": "User deleted successfully"
            })
        else:
            return web.json_response({
                "status": "error",
                "error": "User not found"
            }, status=404)

    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)
