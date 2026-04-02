$python = "C:\Users\VISHAL\AppData\Local\Programs\Python\Python312\python.exe"
Set-Location "$PSScriptRoot\backend\app"
& $python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
