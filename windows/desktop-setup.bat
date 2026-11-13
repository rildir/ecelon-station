@echo off
rem One-time helper: installs the desktop shell (Electron) and starts it. Log: data\desktop-setup.log
cd /d "%~dp0.."
if not exist data mkdir data
echo [%date% %time%] npm install > data\desktop-setup.log
call npm install --no-audit --no-fund >> data\desktop-setup.log 2>&1
echo [npm exit %errorlevel%] >> data\desktop-setup.log
if exist node_modules\electron\dist\electron.exe (echo electron ok >> data\desktop-setup.log) else (echo electron MISSING >> data\desktop-setup.log)
start "" /min cmd /c "npm run desktop"
echo DONE >> data\desktop-setup.log
