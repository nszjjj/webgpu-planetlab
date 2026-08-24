#!/usr/bin/env bash
# scripts/check-import-boundaries.sh
set -e

# 1. framework/ 里不许 import demos/
BAD_A=$(grep -rn "from ['\"].*demos/" src/framework/ --include="*.ts" || true)
if [ -n "$BAD_A" ]; then
  echo "❌ framework/ 里禁止 import demos/："
  echo "$BAD_A"
  exit 1
fi

# 2. framework/core/ 不许 import framework/renderer3d/
BAD_B=$(grep -rn "from ['\"].*framework/renderer3d/" src/framework/core/ --include="*.ts" || true)
if [ -n "$BAD_B" ]; then
  echo "❌ framework/core/ 里禁止 import framework/renderer3d/："
  echo "$BAD_B"
  exit 1
fi

# 3. Node 里不许直接访问 scene.*
BAD_C=$(grep -rEn "scene\.(getEntitiesWith|mainCamera)" src/demos/planet/nodes/ --include="*.ts" || true)
if [ -n "$BAD_C" ]; then
  echo "❌ Node 里不得访问 scene.* 业务查询："
  echo "$BAD_C"
  exit 1
fi

echo "✅ Import boundaries OK"
