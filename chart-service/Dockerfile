FROM python:3.12-slim

WORKDIR /app

COPY chart-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY chart-service/chart_service.py ./chart_service.py

ENV PYTHONUNBUFFERED=1
ENV PORT=5050

EXPOSE 5050

CMD ["python", "chart_service.py"]
