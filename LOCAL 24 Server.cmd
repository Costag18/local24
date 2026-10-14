@echo off
title LOCAL 24 Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -ServerOnly
