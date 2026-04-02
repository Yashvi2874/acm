# 🚀 NSH Debris - Simple Deployment Guide

## ⚡ Quick Deploy to Railway (10 minutes)

### Step 1: Push to GitHub
```powershell
git add .
git commit -m "Hackathon submission"
git push origin main
```

### Step 2: Deploy on Railway

1. **Go to https://railway.app**
2. **Sign up with GitHub** (authorizes access to private repos)
3. **Click "New Project"** → **"Deploy from GitHub repo"**
4. **Select `NSH_debris`** repository

---

## 🔧 Configure 3 Services

### Service 1: Go Adapter
**Settings → Build:**
- Root Directory: `go-adapter`

**Variables:**
```
MONGO_URI=mongodb+srv://rajasekharp_db_user:vM4MT9yMtda7dCKj@nsh-test.klojnbb.mongodb.net/?appName=NSH-Test
PORT=8080
MODE=demo
```

**Networking → Port:** `8080`

✅ Wait for deployment → Copy the URL

---

### Service 2: Python Backend
**New → Empty Service → Name: `acm-backend`**

**Settings → Build:**
- Root Directory: `backend`

**Variables:**
```
GO_ADAPTER_URL=<paste-go-adapter-url-here>
```

**Networking → Port:** `8000`

✅ Wait for deployment → Copy the URL

---

### Service 3: Frontend (MAIN APP)
**New → Empty Service → Name: `frontend`**

**Settings → Build:**
- Root Directory: `frontend`

**Variables:**
```
VITE_API_URL=<paste-backend-url-here>
```

**Networking → Port:** Leave default

✅ **This is your submission URL!**

---

## 🎯 Submit These Links

```
🏠 Live App: https://your-project.up.railway.app
💾 GitHub: https://github.com/Yashvi2874/NSH_debris
```

---

## ✅ Auto-Update on Git Push

Railway automatically rebuilds when you push to GitHub!

```powershell
git add .
git commit -m "Fixed bug"
git push origin main
# That's it! Railway handles the rest in 2-3 minutes
```

---

## 🧪 Test Locally (Optional)

```powershell
docker compose up --build
```

Access at: http://localhost:3000

---

## 🆘 Troubleshooting

**Repo not showing?** 
- Make sure you authorized Railway to access private repos
- Your repo is `NSH_debris` (not NHS_debris)

**Build fails?**
- Check deployment logs in Railway dashboard
- Verify environment variables are correct

**Services won't connect?**
- Wait 3-5 minutes after deployment
- Use HTTPS URLs (not HTTP)

---

## 📞 Need Help?

Railway Discord: https://discord.gg/railway

**Good luck with your hackathon!** 🍀
