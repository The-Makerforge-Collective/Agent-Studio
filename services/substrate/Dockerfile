FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY substrate ./substrate
EXPOSE 9100
CMD ["uvicorn", "substrate.app:app", "--host", "0.0.0.0", "--port", "9100"]
