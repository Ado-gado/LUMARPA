@echo off
echo Копирую проект в C:\lumabot...
if exist C:\lumabot rmdir /s /q C:\lumabot
xcopy /E /I /Q "%~dp0" C:\lumabot
cd /d C:\lumabot
echo Собираю установщик...
set CSC_IDENTITY_AUTO_DISCOVERY=false
npx electron-builder --win nsis --x64
echo Готово! Установщик в C:\lumabot\release\
pause
