import sys
import dotenv
import os
from loguru import logger

dotenv.load_dotenv()

ADMIN_UUID = os.getenv('ADMIN_UUID', 'fda4d49a-54dc-46a7-b7b7-fb40ac179a53')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin_example')
PROTOCOL = os.getenv('PROTOCOL', 'https').lower()
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', '8080'))
MAX_CHAT_MESSAGES = int(os.getenv('MAX_CHAT_MESSAGES', '50'))
LOG_FORMAT = '{time} | {level} | {file} | {line} | {function} | {message} | {extra}'
LOG_FILEPATH = os.getenv('LOG_FILEPATH', '/data/logs/backend_bungaacord.log')
TURN_SECRET_KEY = os.getenv('TURN_SECRET_KEY')

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CERT_FILEPATH = os.path.join(CURRENT_DIR, 'cert.pem')
KEY_FILEPATH = os.path.join(CURRENT_DIR, 'key.pem')

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
