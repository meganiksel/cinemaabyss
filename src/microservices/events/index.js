const express = require('express');
const { Kafka } = require('kafkajs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8082;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'events-service',
  brokers: KAFKA_BROKERS,
  retry: { initialRetryTime: 3000, retries: 10 },
});

const producer = kafka.producer();
let producerReady = false;

async function initProducer() {
  for (let i = 0; i < 30; i++) {
    try {
      await producer.connect();
      producerReady = true;
      console.log('[producer] Connected to Kafka');
      return;
    } catch (err) {
      console.log(`[producer] Waiting for Kafka (attempt ${i + 1}): ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('[producer] Failed to connect to Kafka after 30 attempts');
}

async function startConsumer(topic) {
  const consumer = kafka.consumer({ groupId: `events-service-${topic}` });
  for (let i = 0; i < 30; i++) {
    try {
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          console.log(`[consumer] Topic=${topic} Partition=${partition} Offset=${message.offset} Key=${message.key} Value=${message.value}`);
        },
      });
      console.log(`[consumer] Listening on topic: ${topic}`);
      return;
    } catch (err) {
      console.log(`[consumer] Waiting for Kafka (${topic}, attempt ${i + 1}): ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error(`[consumer] Failed to connect for topic ${topic}`);
}

app.get('/api/events/health', (req, res) => {
  res.json({ status: true });
});

app.post('/api/events/movie', async (req, res) => {
  const { movie_id, title, action } = req.body;
  if (!movie_id || !title || !action) {
    return res.status(400).json({ error: 'movie_id, title and action are required' });
  }
  const eventId = `movie-${movie_id}-${action}`;
  await publishAndRespond(res, 'movie-events', eventId, 'movie', req.body);
});

app.post('/api/events/user', async (req, res) => {
  const { user_id, action, timestamp } = req.body;
  if (!user_id || !action || !timestamp) {
    return res.status(400).json({ error: 'user_id, action and timestamp are required' });
  }
  const eventId = `user-${user_id}-${action}`;
  await publishAndRespond(res, 'user-events', eventId, 'user', req.body);
});

app.post('/api/events/payment', async (req, res) => {
  const { payment_id, user_id, amount, status, timestamp } = req.body;
  if (!payment_id || !user_id || amount === undefined || !status || !timestamp) {
    return res.status(400).json({ error: 'payment_id, user_id, amount, status and timestamp are required' });
  }
  const eventId = `payment-${payment_id}-${status}`;
  await publishAndRespond(res, 'payment-events', eventId, 'payment', req.body);
});

async function publishAndRespond(res, topic, eventId, eventType, payload) {
  if (!producerReady) {
    return res.status(500).json({ error: 'Kafka producer not ready' });
  }

  const event = {
    id: eventId,
    type: eventType,
    timestamp: new Date().toISOString(),
    payload,
  };

  try {
    const result = await producer.send({
      topic,
      messages: [{ key: eventId, value: JSON.stringify(event) }],
    });

    const { partition, baseOffset } = result[0];
    console.log(`[producer] Topic=${topic} Partition=${partition} Offset=${baseOffset} Event=${eventId}`);

    res.status(201).json({
      status: 'success',
      partition,
      offset: parseInt(baseOffset, 10),
      event,
    });
  } catch (err) {
    console.error(`[producer] Error: ${err.message}`);
    res.status(500).json({ error: `Failed to send message to Kafka: ${err.message}` });
  }
}

async function main() {
  await initProducer();

  const topics = ['movie-events', 'user-events', 'payment-events'];
  for (const topic of topics) {
    startConsumer(topic);
  }

  app.listen(PORT, () => {
    console.log(`Events service starting on port ${PORT}`);
  });
}

main().catch(console.error);
