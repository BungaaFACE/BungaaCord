# Backend Dockerfile for BungaaCord
FROM python:slim

WORKDIR /app

COPY backend .

RUN apt-get update && apt-get install -y --no-install-recommends build-essential
RUN pip install -r requirements.txt

CMD ["python", "server.py"]
