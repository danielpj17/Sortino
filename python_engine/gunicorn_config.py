# Gunicorn configuration for Render deployment
# Render may use gunicorn instead of Flask's built-in server

bind = "0.0.0.0:{}".format(os.getenv("PORT", 5000))
workers = 1
timeout = 120
keepalive = 5
