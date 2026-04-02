from aiohttp import web
from database import db


@web.middleware
async def is_admin_middleware(request, handler):
    user_uuid = request.query.get('user', None)
    if not user_uuid:
        return web.HTTPNotFound()
    user = db.get_user_by_uuid(user_uuid)
    if not user or not user.get('is_admin'):
        return web.HTTPNotFound()

    return await handler(request)


@web.middleware
async def is_user_middleware(request, handler):
    user_uuid = request.query.get('user', None)
    if not user_uuid:
        return web.HTTPNotFound()
    user = db.get_user_by_uuid(user_uuid)
    if not user:
        return web.HTTPNotFound()

    return await handler(request)


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)

    response.headers['Access-Control-Allow-Origin'] = '*'  # Можно заменить на конкретный домен
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Credentials'] = 'true'

    return response
