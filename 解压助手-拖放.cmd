@echo off
REM ============================================================
REM  GameHub - 解压助手（拖放版）
REM
REM  用法：把一个或多个压缩包 / 文件夹【拖到本文件图标上】。
REM        会逐个递归解压（压缩包套压缩包一次解到底），完事自动弹报告。
REM        双击（不拖东西）= 显示用法。
REM
REM  为什么要有它：站内 /extract.html 处理的是「站点直链」，
REM        网盘下下来的包只能靠人工丢进去 —— 这个就是那个入口。
REM
REM  解析逻辑与站内页**共用同一份** data/extractor.js，不重写 7z 调用。
REM ============================================================
setlocal EnableExtensions
title GameHub - 解压助手
cd /d "%~dp0"

REM 中文输出必须切码页，否则报告路径在控制台是乱码
chcp 65001 >nul 2>nul

REM ---------- 找 node（不写死版本号：managed 运行时目录名带构建后缀，写死会静默失效）----------
set "NODE="
set "VBASE=%USERPROFILE%\.workbuddy\binaries\node\versions"
where node >nul 2>nul && set "NODE=node"
if not defined NODE for /f "delims=" %%D in ('dir /b /ad /o-n "%VBASE%" 2^>nul') do if not defined NODE if exist "%VBASE%\%%D\node.exe" set "NODE=%VBASE%\%%D\node.exe"
if not defined NODE (
  echo [GameHub] ERROR: 找不到 Node.js。
  echo          请安装 Node 18+，或在本文件里手填 NODE 路径。
  echo.
  pause
  exit /b 1
)

REM ---------- 没拖东西 ----------
if "%~1"=="" (
  echo.
  echo   解压助手 · 递归解压
  echo.
  echo   用法：把一个或多个压缩包 / 文件夹【拖到本文件上】。
  echo.
  echo   会逐层递归解压（压缩包套压缩包一次解到底，默认最多 5 层），
  echo   遇到加密包会在报告里列出来并给出「填密码重跑」的命令。
  echo.
  echo   落点默认「原地解压」（解到包自己所在的目录），原包保留不动。
  echo.
  pause
  exit /b 0
)

echo ============================================================
echo   正在递归解压...
echo ============================================================
echo.
REM ★ 直接用 %*：拖放时 cmd 传进来的参数**已经带好引号**了。
REM   自己用 for 循环把 %1 拼回字符串反而会在路径含 ! 或 & 时出错。
"%NODE%" "tools\extract-cli.js" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0"  echo [GameHub] 全部完成。
if "%RC%"=="3"  echo [GameHub] 有解压失败，请看报告里的「失败」区块。
if "%RC%"=="4"  echo [GameHub] 有包需要密码，请看报告顶部，按里面的命令填密码重跑。
if "%RC%"=="1"  echo [GameHub] 用法提示（没有拖入任何文件）。
if not "%RC%"=="0" if not "%RC%"=="1" if not "%RC%"=="3" if not "%RC%"=="4" echo [GameHub] 未预期的退出码 %RC%。

echo.
echo 按任意键关闭...
pause >nul
