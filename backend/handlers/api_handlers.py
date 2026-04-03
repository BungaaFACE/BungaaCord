import base64
from datetime import datetime
import hashlib
import hmac
import io
import os
import time
from aiohttp import web
from config import TURN_SECRET_KEY
from database import db
from PIL import Image


async def get_messages(request):
    """Получить последние сообщения из базы данных"""
    try:
        limit = int(request.query.get('limit', 20))
        messages = db.get_recent_messages(limit)
        return web.json_response({
            "status": "ok",
            "messages": messages,
            "total": db.get_message_count()
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def get_current_user(request):
    """Получить информацию о текущем пользователе по UUID"""
    try:
        user_uuid = request.query.get('user', None)
        user = db.get_user_by_uuid(user_uuid)

        if not user:
            return web.HTTPNotFound()

        return web.json_response({
            "status": "ok",
            "user": user
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def get_voice_rooms(request):
    """Получить список всех голосовых комнат"""
    try:
        rooms = db.get_voice_rooms()
        return web.json_response({
            "status": "ok",
            "rooms": rooms
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def upload_media(request):
    """Загрузка медиа файлов (изображений/видео)"""
    try:
        user_uuid = request.query.get('user', None)
        user = db.get_user_by_uuid(user_uuid)
        # Читаем multipart данные
        reader = await request.multipart()
        field = await reader.next()

        if not field or field.name != 'file':
            return web.json_response({
                "status": "error",
                "error": "No file provided"
            }, status=400)

        # Проверяем тип файла
        filename = field.filename
        if not filename:
            return web.json_response({
                "status": "error",
                "error": "No filename provided"
            }, status=400)

        # Определяем тип медиа
        file_ext = filename.lower().split('.')[-1]
        is_image = file_ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']
        is_video = file_ext in ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv']

        if not (is_image or is_video):
            return web.json_response({
                "status": "error",
                "error": "Unsupported file type"
            }, status=400)

        # Создаем уникальное имя файла
        import uuid as uuid_lib
        unique_id = uuid_lib.uuid4().hex
        new_filename = f"{unique_id}_{filename}"
        media_path = f"./static/media/{new_filename}"

        # Сохраняем файл
        size = 0
        with open(media_path, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                size += len(chunk)
                f.write(chunk)

        # Проверяем размер файла (макс 50MB)
        if size > 50 * 1024 * 1024:
            os.remove(media_path)
            return web.json_response({
                "status": "error",
                "error": "File too large (max 50MB)"
            }, status=400)

        # Сохраняем информацию о файле в БД
        media_type = 'image' if is_image else 'video'
        media_url = f"/static/media/{new_filename}"
        message_id = db.add_message('media', media_url, user_uuid)

        return web.json_response({
            "status": "ok",
            "message": "File uploaded successfully",
            "file": {
                "id": message_id,
                "filename": new_filename,
                "original_name": filename,
                "url": media_url,
                "type": media_type,
                "size": size,
                "user_uuid": user_uuid,
                "username": user['username'],
                "datetime": datetime.now().isoformat()
            }
        })

    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def upload_avatar(request):
    """Загрузка аватарки пользователя"""
    try:
        user_uuid = request.query.get('user', None)

        # Читаем multipart данные
        reader = await request.multipart()
        field = await reader.next()

        if not field or field.name != 'file':
            return web.json_response({
                "status": "error",
                "error": "No file provided"
            }, status=400)

        # Проверяем тип файла
        filename = field.filename
        if not filename:
            return web.json_response({
                "status": "error",
                "error": "No filename provided"
            }, status=400)

        # Определяем тип файла (только изображения)
        file_ext = filename.lower().split('.')[-1]
        allowed_extensions = ['jpg', 'jpeg', 'png']

        if file_ext not in allowed_extensions:
            return web.json_response({
                "status": "error",
                "error": "Unsupported file type. Only images are allowed."
            }, status=400)

        new_filename = f"{user_uuid}_avatar.jpg"
        avatar_path = f"./static/avatars/{new_filename}"

        # Сохраняем файл
        avatar_buffer = io.BytesIO()
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            avatar_buffer.write(chunk)
        avatar_buffer.seek(0)

        # Проверяем размер файла (макс 10MB)
        if avatar_buffer.getbuffer().nbytes > 10 * 1024 * 1024:
            os.remove(avatar_path)
            return web.json_response({
                "status": "error",
                "error": "File too large (max 10MB)"
            }, status=400)

        image = Image.open(avatar_buffer)
        if file_ext == 'png':
            image = image.convert('RGB')
        image = image.resize((256, 256), Image.Resampling.LANCZOS)
        image.save(avatar_path)

        # Обновляем аватарку пользователя в БД
        avatar_url = f"/static/avatars/{new_filename}"
        db.update_user_avatar(user_uuid, avatar_url)

        return web.json_response({
            "status": "ok",
            "message": "Avatar uploaded successfully",
            "avatar": {
                "url": avatar_url,
                "filename": new_filename,
                "original_name": filename
            }
        })

    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)


async def get_turn_creds(request):
    """Получить TURN credentials для пользователя"""
    try:
        user_uuid = request.query.get('user', None)
        if not user_uuid:
            return web.json_response({
                "status": "error",
                "error": "User UUID is required"
            }, status=400)

        if not TURN_SECRET_KEY:
            raise ValueError("TURN Secret key is not set! Check your environment variables.")

        timestamp = int(time.time()) + 86400  # 24 hours
        username = f"{timestamp}:{user_uuid}"

        # HMAC-SHA1
        digester = hmac.new(TURN_SECRET_KEY.encode('utf-8'), username.encode('utf-8'), hashlib.sha1)
        password = base64.b64encode(digester.digest()).decode('utf-8')

        print(f"🔍 TURN credentials generated: {username} {password}")

        return web.json_response({
            "turn_username": username,
            "turn_password": password
        })
    except Exception as e:
        print(f"❌ Error generating TURN credentials: {e}")
        return web.json_response({
            "status": "error",
            "error": str(e)
        }, status=500)
