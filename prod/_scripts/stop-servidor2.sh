#!/bin/bash

echo "🛑 Parando containers do SERVIDOR 2..."
docker-compose -f wppconnect-build.yml down
echo "✅ Containers do SERVIDOR 2 parados"
