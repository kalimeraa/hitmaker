FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CLOAKBROWSER_CACHE_DIR=/home/pwuser/.cloakbrowser
ENV CLOAKBROWSER_AUTO_UPDATE=false
ENV MONGODB_URI=mongodb://127.0.0.1:27017/hitmaker
ENV REDIS_HOST=127.0.0.1
ENV REDIS_PORT=6379

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg redis-server \
  && curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg \
  && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-org-server \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
RUN mkdir -p /data/db /data/redis \
  && chown -R pwuser:pwuser /app /home/pwuser /data

USER pwuser
RUN npx cloakbrowser install

USER root
COPY --chown=pwuser:pwuser . .
RUN chmod +x /app/railway-start.sh

USER pwuser
EXPOSE 3000

CMD ["./railway-start.sh"]
