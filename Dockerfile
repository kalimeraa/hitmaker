FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CLOAKBROWSER_CACHE_DIR=/home/pwuser/.cloakbrowser
ENV CLOAKBROWSER_AUTO_UPDATE=false

USER root
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
RUN chown -R pwuser:pwuser /app /home/pwuser

USER pwuser
RUN npx cloakbrowser install

USER root
COPY --chown=pwuser:pwuser . .

USER pwuser
EXPOSE 3000

CMD ["npm", "start"]
