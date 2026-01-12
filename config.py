import sys
import dotenv
import os
from loguru import logger

dotenv.load_dotenv(override=True)

ADMIN_UUID = os.getenv('ADMIN_UUID', 'fda4d49a-54dc-46a7-b7b7-fb40ac179a53')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin_example')
PROTOCOL = os.getenv('PROTOCOL', 'https').lower()
HOST = os.getenv('HOST', '0.0.0.0')
PORT = os.getenv('PORT', '8080')
MAX_CHAT_MESSAGES = int(os.getenv('MAX_CHAT_MESSAGES', '50'))
LOG_FORMAT = '{time} | {level} | {file} | {line} | {function} | {message} | {extra}'
LOG_FILEPATH = os.getenv('LOG_FILEPATH', '/data/logs/bungaacord.log')
TURN_SECRET_KEY = os.getenv('TURN_SECRET_KEY')


logger.remove()
logger.add(sys.stdout,
           format=LOG_FORMAT,
           serialize=False,
           level='INFO')
logger.add(LOG_FILEPATH,
           format=LOG_FORMAT,
           serialize=False,
           enqueue=True,
           level='INFO',
           rotation='10 MB',
           retention='3 days',
           compression='gz')
