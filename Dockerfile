# Node 22 is required: the server uses the built-in node:sqlite module (22.5+).
FROM node:22-alpine

WORKDIR /app

# No dependencies to install — the app uses only Node built-ins.
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
# Store the database on the mounted persistent volume, NOT inside the image
# (anything written into the image is lost on every redeploy).
ENV DB_PATH=/data/rsvp.db

EXPOSE 8080

CMD ["node", "--no-warnings", "server.js"]
