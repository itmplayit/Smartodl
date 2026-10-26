@echo off
setlocal EnableDelayedExpansion
title SmartODL Compiler Test
echo ============================================================
echo   SmartODL Compiler Test
echo   Result on each line: [FOUND] / [MISSING] / [PASS] / [FAIL]
echo ============================================================
echo.
set "D=%TEMP%\smartodl-test"
if exist "%D%" rmdir /s /q "%D%" 2>nul
mkdir "%D%" 2>nul

rem =================== STEP 1 : PATH check ===================
echo [STEP 1] Are the compilers on PATH?
echo   (Anything reported as "INFO: Could not find" is MISSING)
echo.
where gcc
where g++
where javac
where java
where python
where node
echo ------------------------------------------------------------
echo.

rem =================== STEP 2 : C++ ============================
echo [STEP 2] C++ compile + run test...
where g++ >nul 2>&1
if errorlevel 1 goto CPP_MISS
> "%D%\t.cpp" echo #include ^<iostream^>
>> "%D%\t.cpp" echo using namespace std;
>> "%D%\t.cpp" echo int main^(^){ int n=5; int a[n]; for^(int i=0;i^<n;i++^) a[i]=i*i; for^(int i=0;i^<n;i++^) cout^<^<a[i]^<^<" "; }
g++ -O2 -std=gnu++17 -o "%D%\t.exe" "%D%\t.cpp" 2>"%D%\cpp-err.txt"
if not exist "%D%\t.exe" goto CPP_CFAIL
"%D%\t.exe" >"%D%\cpp-out.txt" 2>&1
if errorlevel 1 goto CPP_BLOCKED
set /p OUT=<"%D%\cpp-out.txt"
echo    [PASS] g++ compile + run OK -- output: !OUT!
goto JAVA

:CPP_MISS
echo    [MISSING] g++ was not found, so C++ will never compile.
echo            Fix: install GCC through MSYS2 (https://www.msys2.org) and
echo            add C:\msys64\ucrt64\bin to PATH.
goto JAVA

:CPP_CFAIL
echo    [FAIL] g++ was found, but compilation failed. Here is the error:
if exist "%D%\cpp-err.txt" type "%D%\cpp-err.txt"
goto JAVA

:CPP_BLOCKED
echo    [BLOCKED] t.exe was created but DID NOT RUN — antivirus software is blocking it.
echo            Add %TEMP% under Windows Security -^> Exclusions.
goto JAVA

rem =================== STEP 3 : Java ===========================
:JAVA
echo.
echo [STEP 3] Java compile + run test...
where javac >nul 2>&1
if errorlevel 1 goto JAVA_MISS
> "%D%\Test.java" echo public class Test { public static void main^(String[] a^){ System.out.println^("java-ok"^); } }
javac -d "%D%" "%D%\Test.java" 2>"%D%\java-err.txt"
if not exist "%D%\Test.class" goto JAVA_CFAIL
pushd "%D%"
java -cp . Test
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" goto JAVA_RFAIL
echo    [PASS] javac + java OK
goto PY

:JAVA_MISS
echo    [MISSING] javac was not found, so Java cannot be compiled.
echo            Fix: install JDK 21 (a JRE alone is not sufficient).
goto PY

:JAVA_CFAIL
echo    [FAIL] javac was found, but compilation failed. Here is the error:
if exist "%D%\java-err.txt" type "%D%\java-err.txt"
goto PY

:JAVA_RFAIL
echo    [FAIL] Compilation succeeded, but Java did not run.
goto PY

rem =================== STEP 4 : Python =========================
:PY
echo.
echo [STEP 4] Python test...
where python >nul 2>&1
if errorlevel 1 goto PY_MISS
> "%D%\t.py" echo print("python-ok")
python "%D%\t.py"
if errorlevel 1 goto PY_RFAIL
echo    [PASS] python OK
goto NODE

:PY_MISS
echo    [MISSING] Python is not on PATH.
goto NODE

:PY_RFAIL
echo    [FAIL] Python runtime error.
goto NODE

rem =================== STEP 5 : Node ===========================
:NODE
echo.
echo [STEP 5] JavaScript/Node test...
where node >nul 2>&1
if errorlevel 1 goto NODE_MISS
> "%D%\t.js" echo console.log("js-ok")
node "%D%\t.js"
if errorlevel 1 goto NODE_RFAIL
echo    [PASS] node OK
goto SUMMARY

:NODE_MISS
echo    [MISSING] Node.js is not on PATH.
goto SUMMARY

:NODE_RFAIL
echo    [FAIL] Node.js runtime error.
goto SUMMARY

rem =================== SUMMARY =================================
:SUMMARY
echo.
echo ============================================================
echo   HOW TO USE THESE RESULTS:
echo   * For anything shown as MISSING in STEP 1, add its bin folder to PATH
echo     (Windows key -^> "environment variables" -^> Path -^> New).
echo   * Then CLOSE the "SmartODL Judge Worker" window and run Setup.bat
echo     again (a restart is required).
echo   * Send a photo or copy of this window if anything gets stuck.
echo ============================================================
echo.
pause
endlocal
