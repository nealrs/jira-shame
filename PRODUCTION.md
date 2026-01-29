# Production Deployment Guide

This guide covers deploying Jira Shame to production environments.

## Quick Start

### Option 1: Docker (Recommended)

1. **Set environment variables** in `.env` or pass them directly:
   ```bash
   export JIRA_HOST=your-domain.atlassian.net
   export JIRA_EMAIL=your-email@example.com
   export JIRA_API_TOKEN=your-api-token
   export JIRA_BOARD_ID=7
   export NODE_ENV=production
   export DEBUG=false
   export PORT=3000
   ```

2. **Build and run with Docker:**
   ```bash
   docker build -t jira-shame .
   docker run -d \
     --name jira-shame \
     --restart unless-stopped \
     -p 3000:3000 \
     --env-file .env \
     jira-shame
   ```

3. **Or use docker-compose (production):**
   ```bash
   docker-compose -f docker-compose.prod.yaml up -d
   ```
   By default the app is published on **port 1337** (same as dev). To use a different host port, run `PORT=3000 docker-compose -f docker-compose.prod.yaml up -d` (or set `PORT` in `.env`).

### Option 2: Direct Node.js

1. **Install dependencies:**
   ```bash
   npm ci --production
   ```

2. **Set environment variables:**
   ```bash
   export NODE_ENV=production
   export DEBUG=false
   # ... other required vars
   ```

3. **Start with PM2 (recommended for production):**
   ```bash
   npm install -g pm2
   pm2 start server.js --name jira-shame
   pm2 save
   pm2 startup  # Follow instructions to enable auto-start on boot
   ```

4. **Or start directly:**
   ```bash
   npm start
   ```

## Environment Variables

### Required
- `JIRA_HOST` - Your Jira instance hostname (e.g., `your-domain.atlassian.net`)
- `JIRA_EMAIL` - Your Jira account email
- `JIRA_API_TOKEN` - Your Jira API token

### Optional
- `JIRA_BOARD_ID` - Jira board ID (default: `7`)
- `PORT` - Server port (default: `3000`)
- `NODE_ENV` - Set to `production` for production mode
- `DEBUG` - Set to `false` to disable debug logging (defaults to `false` when `NODE_ENV=production`)
- `GITHUB_TOKEN` - GitHub personal access token (required for `/pr` route)
- `GITHUB_ORG` - GitHub organization name (required for `/pr` route)

## Production Configuration

### Dockerfile

The included `Dockerfile` is optimized for production:
- Uses `node:18-alpine` for smaller image size
- Installs only production dependencies
- Runs as non-root user (recommended for security)

### Process Management

For production, use a process manager to:
- Auto-restart on crashes
- Manage logs
- Handle graceful shutdowns

**PM2 (Recommended):**
```bash
npm install -g pm2
pm2 start server.js --name jira-shame -i max
pm2 save
pm2 startup
```

**systemd (Linux):**
Create `/etc/systemd/system/jira-shame.service`:
```ini
[Unit]
Description=Jira Shame Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/jira-shame
Environment="NODE_ENV=production"
EnvironmentFile=/path/to/jira-shame/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable jira-shame
sudo systemctl start jira-shame
```

## Reverse Proxy Setup

### Nginx

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Apache

Example Apache configuration:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    <Proxy *>
        Order deny,allow
        Allow from all
    </Proxy>
</VirtualHost>
```

## Security Considerations

1. **Never commit `.env` files** - They contain sensitive API tokens
2. **Use HTTPS** - Set up SSL/TLS certificates (Let's Encrypt recommended)
3. **Firewall** - Only expose necessary ports
4. **Rate Limiting** - Consider adding rate limiting middleware for production
5. **Security Headers** - Add security headers (see IMPROVEMENTS.md #26)
6. **Keep dependencies updated** - Regularly run `npm audit` and update packages

## Monitoring

### Health Check Endpoint

The application doesn't currently have a health check endpoint. Consider adding one:

```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Logging

Logs are output to stdout/stderr. In production:
- Use a log aggregation service (e.g., CloudWatch, Datadog, Loggly)
- Or configure log rotation with `logrotate` or PM2

### PM2 Monitoring

```bash
pm2 monit  # Real-time monitoring
pm2 logs jira-shame  # View logs
pm2 status  # Check process status
```

## Scaling

### Horizontal Scaling

For multiple instances behind a load balancer:
- Ensure session storage is not used for critical state (current implementation uses client-side sessionStorage)
- Consider Redis for shared caching (see IMPROVEMENTS.md #1)
- Use sticky sessions if needed

### Vertical Scaling

- Increase Node.js memory limit if needed: `node --max-old-space-size=4096 server.js`
- Monitor API rate limits (Jira/GitHub have rate limits)

## Troubleshooting

### Application won't start
- Check environment variables are set correctly
- Verify port is not already in use: `lsof -i :3000`
- Check logs for error messages

### High memory usage
- Monitor with `pm2 monit` or `htop`
- Consider implementing API response caching (see IMPROVEMENTS.md #1)
- Review parallel API request patterns

### API rate limiting
- The application includes retry logic with exponential backoff
- Monitor rate limit headers in logs
- Consider implementing request queuing for high-traffic scenarios

## Backup & Recovery

- **No database** - Application is stateless, no backups needed
- **Configuration** - Backup your `.env` file securely
- **Docker images** - Tag and push to a registry for easy deployment

## Updates & Deployment

### Docker
```bash
docker pull jira-shame:latest  # If using registry
docker stop jira-shame
docker rm jira-shame
docker run -d --name jira-shame ...  # New container
```

### Direct Node.js
```bash
git pull
npm ci --production
pm2 restart jira-shame
```

## Performance Optimization

For production, consider implementing:
1. **API Response Caching** (IMPROVEMENTS.md #1) - Reduces API calls significantly
2. **Asset Minification** (IMPROVEMENTS.md #5) - Smaller bundle sizes
3. **Gzip Compression** - Enable in reverse proxy or Express middleware
4. **CDN** - Serve static assets from a CDN

## Support

For issues or questions:
- Check the README.md for setup instructions
- Review IMPROVEMENTS.md for known issues and planned improvements
- Check application logs for detailed error messages
