require('dotenv').config();
const express = require('express');
const webPush = require('web-push');
const schedule = require('node-schedule');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// VAPID keys from environment variables
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};

// Validate VAPID keys
if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  console.error('Error: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in .env or environment variables');
  process.exit(1);
}

// Configure web-push
webPush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'your-email@example.com'}`,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Store push subscriptions and reminders
const subscriptions = new Map(); // Map<subscriptionId, subscription>
const reminders = new Map(); // Map<taskId, scheduledJob>

// API to receive push subscriptions and reminders
app.post('/api/subscribe', (req, res) => {
  const { subscription, taskId, taskText, dueDate } = req.body;

  // Validate request body
  if (!subscription || !taskId || !taskText || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields: subscription, taskId, taskText, dueDate' });
  }

  // Store subscription
  const subscriptionId = Buffer.from(subscription.endpoint).toString('base64');
  subscriptions.set(subscriptionId, subscription);
  console.log('Stored subscription:', subscriptionId);

  // Schedule reminder
  const dueDateTime = new Date(dueDate);
  if (isNaN(dueDateTime.getTime())) {
    return res.status(400).json({ error: 'Invalid due date format' });
  }

  const job = schedule.scheduleJob(dueDateTime, () => {
    console.log(`Sending reminder for task: ${taskText} (ID: ${taskId})`);
    const payload = JSON.stringify({
      title: 'To-Do Reminder',
      body: `Time to work on: ${taskText}\nDue: ${dueDateTime.toLocaleString()}`,
      icon: '/todo-pwa/icon-192x192.png'
    });

    webPush.sendNotification(subscription, payload)
      .then(() => {
        console.log('Push notification sent:', taskId);
        // Clean up after sending
        reminders.delete(taskId);
      })
      .catch(err => {
        console.error('Failed to send push notification:', err);
        // Remove subscription if invalid
        subscriptions.delete(subscriptionId);
        reminders.delete(taskId);
      });
  });

  reminders.set(taskId, job);
  console.log('Scheduled reminder for task:', taskId, 'at', dueDate);

  res.status(201).json({ success: true });
});

// Serve VAPID public key
app.get('/api/vapidPublicKey', (req, res) => {
  if (!vapidKeys.publicKey) {
    return res.status(500).json({ error: 'VAPID public key not configured' });
  }
  res.json({ publicKey: vapidKeys.publicKey });
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', subscriptions: subscriptions.size, reminders: reminders.size });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  schedule.gracefulShutdown().then(() => {
    console.log('All scheduled jobs cancelled');
    process.exit(0);
  });
});