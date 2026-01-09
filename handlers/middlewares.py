from aiohttp import web
from database import db


@web.middleware
async def is_admin_middleware(request, handler):
    user_uuid = request.query.get('user', None)
    print(user_uuid)
    if not user_uuid:
        return web.HTTPNotFound()
    user = db.get_user_by_uuid(user_uuid)
    print(user)
    if not user or not user.get('is_admin'):
        return web.HTTPNotFound()

    return await handler(request)


@web.middleware
async def is_user_middleware(request, handler):
    user_uuid = request.query.get('user', None)
    print(user_uuid)
    if not user_uuid:
        return web.HTTPNotFound()
    user = db.get_user_by_uuid(user_uuid)
    print(user)
    if not user:
        return web.HTTPNotFound()

    return await handler(request)
