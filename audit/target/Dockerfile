# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 debian:bookworm-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867

ARG CFT_VERSION=143.0.7499.40
ARG HEADLESS_SHELL_SHA256=30a1a2545fb99b76d213e3afe0e25c51bef05e2fbe970f2c0f604eeec153294a
ARG CHROME_SHA256=149b71620aaf96d94f7500995aa58baabb7702e29c0a7cbef62d14a75f865068

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl iptables socat unzip \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --retry 3 --output /tmp/chrome-headless-shell.zip "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VERSION}/linux64/chrome-headless-shell-linux64.zip" \
 && echo "${HEADLESS_SHELL_SHA256}  /tmp/chrome-headless-shell.zip" | sha256sum --check \
 && unzip -q /tmp/chrome-headless-shell.zip -d /opt \
 && rm /tmp/chrome-headless-shell.zip \
 && curl --fail --location --retry 3 --output /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VERSION}/linux64/chrome-linux64.zip" \
 && echo "${CHROME_SHA256}  /tmp/chrome.zip" | sha256sum --check \
 && unzip -q /tmp/chrome.zip -d /opt \
 && rm /tmp/chrome.zip

COPY entrypoint.sh /usr/local/bin/audit-chrome
RUN chmod 0755 /usr/local/bin/audit-chrome \
 && useradd --system --create-home --uid 10001 chrome

EXPOSE 9222
ENTRYPOINT ["/usr/local/bin/audit-chrome"]
