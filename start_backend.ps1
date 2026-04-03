Set-Location backend/app
py -m uvicorn main:app --host 0.0.0.0 --port 8000
