# Dark Phys — Final Windows Setup (Roman Urdu)

Yeh guide Windows 10/11 ke liye hai. Pehle normal setup karo; agar PC slow ho to lightweight launcher use karo.

## 1) Zaroori cheezein install karo

- **Git for Windows:** https://git-scm.com/download/win
- **Node.js 20 LTS:** https://nodejs.org/
- **Python 3.10 ya newer:** https://www.python.org/downloads/ — installation ke waqt **Add Python to PATH** select karo.
- **FFmpeg:** https://ffmpeg.org/download.html — Windows build install karo aur ffmpeg/ffprobe ko PATH mein add karo.

PowerShell band karke dobara kholo, phir versions check karo:

~~~powershell
git --version
node --version
npm --version
python --version
ffmpeg -version
ffprobe -version
~~~

## 2) Repository folder kholo

GitHub se Dark Phys ka ZIP download/extract karo, ya Git se clone karo:

~~~powershell
git clone https://github.com/Abdul-wahab1101/dark-phys.git
cd dark-phys
git checkout integration/dark-phys-final
~~~

Agar ZIP use ki hai to extracted dark-phys folder mein PowerShell kholo. Final integration branch ka code hi use karna.

## 3) Engines install karo

PowerShell mein:

~~~powershell
Set-ExecutionPolicy -Scope Process Bypass
./setup-dark-phys.ps1
~~~

Yeh pinned YouTube Automation Agent ko engines folder mein clone karta hai, dependencies install karta hai, aur Playwright Chromium install karta hai. OpenMontage default setup ka hissa nahi—yeh optional aur heavy hai. Jab advanced rendering ki zaroorat ho tab alag se `./setup-openmontage.ps1` chalao. Iske Remotion Composer ke liye Node.js 22.23.4+, 24.22.1+ ya 26.12.1+ supported release chahiye; installer version check karega. Internet aur disk space ki zaroorat hogi; pehli installation mein waqt lag sakta hai.

Agar script fail ho to error ka exact text copy karke share karo. Existing engine folders mein local changes hon to setup script unhein overwrite nahi karta.

## 4) API key configure karo

File kholo:

engines/youtube-automation-agent/.env

Provider ki API key us provider ke documented variable name ke mutabiq add karo. Kisi bhi API key, OAuth secret ya token ko GitHub par upload/commit mat karna. Free-tier availability aur limits provider ke hisaab se badalti hain.

YouTube channel connect/publish karna ho to pehle upstream guide ke mutabiq Google OAuth Desktop credentials configure karo. Publishing manual approval ke baghair nahi honi chahiye.

## 5) Main automation dashboard start karo

Normal mode:

~~~powershell
./start-dark-phys.ps1
~~~

Browser mein kholo:

http://localhost:3456

Agar tumhara PC slow ho, normal launcher band karo aur lightweight mode chalao:

~~~powershell
./start-dark-phys-lite.ps1
~~~

Lightweight mode Node heap ko 2 GB tak limit karta hai aur process priority kam karne ki koshish karta hai. Ek waqt mein ek project render karo. 8 GB RAM wale PC par render slow ho sakta hai; browser tabs aur background apps band rakho.

## 6) Universal Doctor dashboard (alag tool)

Yeh YouTube dashboard se alag local dashboard hai. Repository root mein doosri PowerShell window kholo:

~~~powershell
python agents/universal-doctor/doctor.py selftest
python agents/universal-doctor/doctor.py dashboard .
~~~

Browser mein kholo:

http://127.0.0.1:8765

Doctor ka default mode **diagnostic** hai. Repair mode ko tab tak change na karo jab tak findings aur proposed changes samajh na aa jayein. Dashboard localhost-only hai.

## 7) Quick tests

Repository root se:

~~~powershell
python scripts/test-dashboard-launch.py
# Main YouTube dashboard smoke test (upstream engine dependencies installed hon):
node scripts/test-main-dashboard-launch.js
python agents/universal-doctor/doctor.py selftest
node scripts/test-openmontage-handoff.js
node scripts/test-video-planner.js
node scripts/test-quality-check.js
~~~

Windows script syntax/config validation:

~~~powershell
./scripts/test-windows-setup.ps1
~~~

## 8) Agar issue aaye

- **'python' not recognized:** Python reinstall karo aur Add Python to PATH select karo.
- **'npm' not recognized:** Node.js 20 LTS reinstall karke PowerShell dobara kholo.
- **'ffmpeg' not recognized:** FFmpeg ke bin folder ko Windows PATH mein add karo.
- **Port 3456/8765 busy:** Pehle se chalti hui app band karo, phir dobara start karo.
- **Dashboard open nahi hota:** PowerShell window mein startup error dekho; process ko band mat karo jab tak dashboard use kar rahe ho.
- **API key missing/provider error:** .env mein provider key aur uska exact variable name verify karo. Keys chat ya GitHub par paste na karo.

## Testing ki sachchi boundary

GitHub Actions par Windows PowerShell scripts ki syntax/configuration validation aur Windows par Doctor dashboard ka HTTP smoke test hota hai. Linux CI pinned YouTube automation dashboard ko setup-required mode mein launch karke HTML/health endpoint check karta hai. Synthetic 5-second MP4 encode/probe bhi automated hai. Linux CI par OpenMontage Remotion demo render bhi test hota hai. Yeh checks tumhare apne PC par poora setup, tumhari API key, OAuth login, 8–12 minute final episode, ya real YouTube upload ko certify nahi karte. Pehli dafa apne PC par run karke agar error aaye to uska screenshot ya exact text bhejna.
