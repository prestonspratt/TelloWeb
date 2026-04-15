#!/bin/bash
echo ""
echo " DroneCode Proxy Launcher"
echo " ========================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " ERROR: Node.js is not installed!"
    echo " Install it from https://nodejs.org (LTS version)"
    echo " Or on Mac: brew install node"
    echo ""
    exit 1
fi

echo " Node.js found: $(node --version)"

# Install deps if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo " Installing dependencies..."
    npm install
fi

echo ""
echo " Starting proxy server..."
echo " Press Ctrl+C to stop."
echo ""
node proxy.js
