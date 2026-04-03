"""Run this after whitelisting 49.36.97.158 in Atlas Network Access."""
from pymongo import MongoClient

URI = "mongodb+srv://yashasvig_db_user:ENzdThDvVBAg6VUi@cluster0.ltykwqy.mongodb.net/?appName=ACM&tls=true&tlsInsecure=true"

try:
    c = MongoClient(URI, serverSelectionTimeoutMS=10000)
    c.admin.command("ping")
    print("CONNECTED OK")
    db = c["cubesat"]
    print("Collections:", db.list_collection_names())
    # Write a test document
    db["test"].insert_one({"ping": "ok"})
    print("Write OK")
    db["test"].delete_many({"ping": "ok"})
    c.close()
except Exception as e:
    print("FAILED:", str(e)[:200])
