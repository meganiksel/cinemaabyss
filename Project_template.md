## Изучите [README.md](README.md) файл и структуру проекта.

## Задание 1

1. Спроектируйте to be архитектуру КиноБездны, разделив всю систему на отдельные домены и организовав интеграционное взаимодействие и единую точку вызова сервисов.
Результат представьте в виде контейнерной диаграммы в нотации С4.
Добавьте ссылку на файл в этот шаблон
[C4 Container Diagram — To-Be Architecture](docs/c4-container-diagram.md)

### Описание целевой архитектуры

Система разделена на следующие домены:
- **Content (Movies Service)** — метаданные фильмов, жанры, рейтинги. Выделен из монолита.
- **Users (Monolith)** — управление пользователями, аутентификация.
- **Billing (Monolith)** — платежи, подписки.
- **Events (Events Service)** — событийная шина через Apache Kafka для асинхронной коммуникации.
- **Gateway (Proxy Service)** — единая точка входа (API Gateway), реализует паттерн Strangler Fig для постепенного переключения трафика.

Все клиентские запросы проходят через API Gateway, который маршрутизирует их к соответствующим сервисам. Переключение трафика `/api/movies` между монолитом и микросервисом управляется через Feature Flag (`GRADUAL_MIGRATION` + `MOVIES_MIGRATION_PERCENT`).


## Задание 2

### 1. Proxy
Команда КиноБездны уже выделила сервис метаданных о фильмах movies и вам необходимо реализовать бесшовный переход с применением паттерна Strangler Fig в части реализации прокси-сервиса (API Gateway), с помощью которого можно будет постепенно переключать траффик, используя фиче-флаг.


Реализуйте сервис на любом языке программирования в ./src/microservices/proxy.
Конфигурация для запуска сервиса через docker-compose уже добавлена
```yaml
  proxy-service:
    build:
      context: ./src/microservices/proxy
      dockerfile: Dockerfile
    container_name: cinemaabyss-proxy-service
    depends_on:
      - monolith
      - movies-service
      - events-service
    ports:
      - "8000:8000"
    environment:
      PORT: 8000
      MONOLITH_URL: http://monolith:8080
      #монолит
      MOVIES_SERVICE_URL: http://movies-service:8081 #сервис movies
      EVENTS_SERVICE_URL: http://events-service:8082 
      GRADUAL_MIGRATION: "true" # вкл/выкл простого фиче-флага
      MOVIES_MIGRATION_PERCENT: "50" # процент миграции
    networks:
      - cinemaabyss-network
```

#### Реализация

Прокси-сервис реализован на Node.js (Express) в [src/microservices/proxy/](src/microservices/proxy/):
- **[index.js](src/microservices/proxy/index.js)** — HTTP reverse proxy с использованием `express` и `http-proxy-middleware`
- **[Dockerfile](src/microservices/proxy/Dockerfile)** — Node 18-alpine
- **[package.json](src/microservices/proxy/package.json)** — зависимости: express, http-proxy-middleware

Логика маршрутизации:
- `GET /health` — возвращает `"Strangler Fig Proxy is healthy"`
- `/api/movies` — при `GRADUAL_MIGRATION=true` направляет `MOVIES_MIGRATION_PERCENT`% запросов в movies-service, остальные в монолит. При `GRADUAL_MIGRATION=false` — все в movies-service
- `/api/users`, `/api/payments`, `/api/subscriptions` — всегда в монолит
- `/api/events/*` — в events-service


### 2. Kafka
 Вам как архитектуру нужно также проверить гипотезу насколько просто реализовать применение Kafka в данной архитектуре.

Для этого нужно сделать MVP сервис events, который будет при вызове API создавать и сам же читать сообщения в топике Kafka.

    - Разработайте сервис на любом языке программирования с consumer'ами и producer'ами.
    - Реализуйте простой API, при вызове которого будут создаваться события User/Payment/Movie и обрабатываться внутри сервиса с записью в лог
    - Добавьте в docker-compose новый сервис, kafka там уже есть

#### Реализация

Events-сервис реализован на Node.js (Express) в [src/microservices/events/](src/microservices/events/):
- **[index.js](src/microservices/events/index.js)** — HTTP API + Kafka producer/consumer с использованием `kafkajs`
- **[Dockerfile](src/microservices/events/Dockerfile)** — Node 18-alpine
- **[package.json](src/microservices/events/package.json)** — зависимости: express, kafkajs

API:
- `GET /api/events/health` — `{"status": true}`
- `POST /api/events/movie` — создаёт событие фильма в топик `movie-events`
- `POST /api/events/user` — создаёт событие пользователя в топик `user-events`
- `POST /api/events/payment` — создаёт событие платежа в топик `payment-events`

При старте сервис запускает 3 фоновых consumer'а (по одному на топик), которые читают сообщения и пишут в лог. Producer — синхронный, отправляет сообщение и возвращает partition/offset в ответе API.


## Задание 3

Команда начала переезд в Kubernetes для лучшего масштабирования и повышения надежности. 
Вам, как архитектору осталось самое сложное:
 - реализовать CI/CD для сборки прокси сервиса
 - реализовать необходимые конфигурационные файлы для переключения трафика.


### CI/CD

 В папке .github/worflows доработайте деплой новых сервисов proxy и events в docker-build-push.yml , чтобы api-tests при сборке отрабатывали корректно при отправке коммита в вашу новую ветку.

#### Реализация

Файл [.github/workflows/docker-build-push.yml](.github/workflows/docker-build-push.yml) доработан:

1. Добавлена ветка `cinema` в триггер push:
```yaml
on:
  push:
    branches: [ main, cinema ]
```

2. Добавлены шаги сборки и push для Events Service и Proxy Service по аналогии с Monolith и Movies Service:
   - Extract metadata + Build and push для `events-service` (контекст `./src/microservices/events`)
   - Extract metadata + Build and push для `proxy-service` (контекст `./src/microservices/proxy`)

### Proxy в Kubernetes


#### Реализация

Созданы Kubernetes-манифесты:

- **[src/kubernetes/proxy-service.yaml](src/kubernetes/proxy-service.yaml)** — Deployment + Service для прокси на порту 8000. Env-переменные берутся из ConfigMap (`MONOLITH_URL`, `MOVIES_SERVICE_URL`, `EVENTS_SERVICE_URL`, `GRADUAL_MIGRATION`, `MOVIES_MIGRATION_PERCENT`). Health probes на `/health`.

- **[src/kubernetes/events-service.yaml](src/kubernetes/events-service.yaml)** — Deployment + Service для events на порту 8082. `KAFKA_BROKERS=kafka:9092`. Health probes на `/api/events/health`.

- **[src/kubernetes/ingress.yaml](src/kubernetes/ingress.yaml)** — доработан: добавлен путь `/` -> proxy-service:8000 и `/api/events` -> events-service:8082.

- **[src/kubernetes/configmap.yaml](src/kubernetes/configmap.yaml)** — добавлен `EVENTS_SERVICE_URL`.


## Задание 4
Для простоты дальнейшего обновления и развертывания вам как архитектуру необходимо так же реализовать helm-чарты для прокси-сервиса и проверить работу 


#### Реализация

Helm-шаблоны заполнены:

- **[src/kubernetes/helm/templates/services/proxy-service.yaml](src/kubernetes/helm/templates/services/proxy-service.yaml)** — Deployment + Service с параметризацией через `values.yaml`. Контейнер получает env-переменные из ConfigMap. Health probes на `/health`.

- **[src/kubernetes/helm/templates/services/events-service.yaml](src/kubernetes/helm/templates/services/events-service.yaml)** — Deployment + Service с параметризацией. `KAFKA_BROKERS=kafka:9092`. Health probes на `/api/events/health`.

- **[src/kubernetes/helm/templates/configmap.yaml](src/kubernetes/helm/templates/configmap.yaml)** — добавлен `EVENTS_SERVICE_URL`, исправлен URL movies-service.

# Задание 5
Компания планирует активно развиваться и для повышения надежности, безопасности, реализации сетевых паттернов типа Circuit Breaker и канареечного деплоя вам как архитектору необходимо развернуть istio и настроить circuit breaker для monolith и movies сервисов.

#### Реализация

Создан файл конфигурации Circuit Breaker: **[src/kubernetes/circuit-breaker-config.yaml](src/kubernetes/circuit-breaker-config.yaml)**

Содержит два `DestinationRule` для Istio:
- **monolith-circuit-breaker** — для сервиса `monolith`
- **movies-service-circuit-breaker** — для сервиса `movies-service`

Настройки:
- `maxConnections: 1` — максимум 1 TCP-соединение
- `http1MaxPendingRequests: 1` — максимум 1 ожидающий HTTP-запрос
- `maxRequestsPerConnection: 1` — максимум 1 запрос на соединение
- `consecutive5xxErrors: 1` — circuit breaker срабатывает после 1 ошибки 5xx
- `baseEjectionTime: 3m` — время исключения хоста из балансировки
- `maxEjectionPercent: 100` — может исключить до 100% хостов

