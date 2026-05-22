
    const schema = {
  "asyncapi": "2.6.0",
  "info": {
    "title": "PixPro WebSocket Hubs",
    "version": "1.0.0",
    "description": "WebSocket hubs for real-time notifications and updates in PixPro."
  },
  "servers": {
    "production": {
      "url": "ws://api.pixpro.local/hub",
      "protocol": "ws",
      "description": "Production WebSocket Hub Server",
      "security": [
        {
          "jwt": []
        }
      ]
    }
  },
  "channels": {
    "notifications": {
      "description": "Channel for real-time user notifications.",
      "subscribe": {
        "operationId": "receiveNotification",
        "message": {
          "name": "Notification",
          "title": "Notification Message",
          "summary": "A message containing notification details.",
          "contentType": "application/json",
          "payload": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid",
                "description": "Unique identifier of the notification.",
                "x-parser-schema-id": "<anonymous-schema-2>"
              },
              "type": {
                "type": "string",
                "description": "The type of notification (e.g., 'PROJECT_COMPLETED', 'NEW_MESSAGE').",
                "x-parser-schema-id": "<anonymous-schema-3>"
              },
              "content": {
                "type": "string",
                "description": "The actual text content or payload of the notification.",
                "x-parser-schema-id": "<anonymous-schema-4>"
              },
              "timestamp": {
                "type": "string",
                "format": "date-time",
                "description": "The time the notification was sent.",
                "x-parser-schema-id": "<anonymous-schema-5>"
              }
            },
            "required": [
              "id",
              "type",
              "content",
              "timestamp"
            ],
            "x-parser-schema-id": "<anonymous-schema-1>"
          }
        }
      }
    },
    "project_updates": {
      "description": "Channel for real-time updates on project processing status.",
      "subscribe": {
        "operationId": "receiveProjectUpdate",
        "message": "$ref:$.channels.notifications.subscribe.message"
      }
    }
  },
  "components": {
    "messages": {
      "NotificationMessage": "$ref:$.channels.notifications.subscribe.message"
    },
    "securitySchemes": {
      "jwt": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Use a JWT token for authentication."
      }
    }
  },
  "x-parser-spec-parsed": true,
  "x-parser-api-version": 3,
  "x-parser-spec-stringified": true
};
    const config = {"show":{"sidebar":true},"sidebar":{"showOperations":"byDefault"}};
    const appRoot = document.getElementById('root');
    AsyncApiStandalone.render(
        { schema, config, }, appRoot
    );
  