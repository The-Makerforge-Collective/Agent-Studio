# Agent Studio control-plane API — M0 skeleton image
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agentstudio ./agentstudio
EXPOSE 8080
CMD ["uvicorn", "agentstudio.app:app", "--host", "0.0.0.0", "--port", "8080"]
