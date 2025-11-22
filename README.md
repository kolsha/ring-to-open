# Ring to Open

Automatically open your door when someone rings your Ring Intercom during daytime hours.

## Features

- 🔔 **Doorbell Detection**: Listens for doorbell presses on your Ring Intercom
- ⏰ **Time-based Logic**: Only auto-opens during configured daytime hours
- 🔓 **Smart Door Control**: Automatically unlocks/opens your door via Ring Intercom
- 🛡️ **Safety**: Disabled during nighttime hours for security
- 🔧 **Configurable**: Easy setup with environment variables

## Setup

### 1. Prerequisites

- Node.js (v18 or higher)
- Ring account with Intercom device
- Ring Intercom device properly installed and connected

### 2. Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd ring-to-open

# Install dependencies
npm install
```

### 3. Authentication

Get your Ring refresh token:

```bash
npm run auth
```

This will prompt you for your Ring email/password and output a refresh token. Copy the token value (without quotes).

### 4. Configuration

Create a `.env` file in the project root:

```bash
cp env.example .env
```

Edit the `.env` file with your settings:

```env
# Ring API Configuration
RING_REFRESH_TOKEN=your_refresh_token_here

# Door Configuration
DOOR_OPEN_TIME=08:00
DOOR_CLOSE_TIME=22:00
AUTO_OPEN_ENABLED=true

# Optional: Specific door device ID (if you know your device ID)
# DOOR_DEVICE_ID=your_device_id_here

# Debug mode (optional)
DEBUG=false
```

### Configuration Options

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `RING_REFRESH_TOKEN` | Your Ring API refresh token | Required | `eyJhbGciOi...` |
| `DOOR_OPEN_TIME` | Start time for auto-open (24h format) | `08:00` | `08:00` |
| `DOOR_CLOSE_TIME` | End time for auto-open (24h format) | `22:00` | `22:00` |
| `AUTO_OPEN_ENABLED` | Enable/disable auto-open feature | `true` | `true` |
| `DOOR_DEVICE_ID` | Specific device ID (optional) | - | `device_123` |
| `DEBUG` | Enable debug logging | `false` | `true` |

## Usage

### Start the Service

```bash
npm run ring-to-open
```

The service will:
1. Connect to your Ring account
2. Discover all your Ring devices
3. Listen for doorbell presses
4. Automatically open the door during daytime hours

### Example Output

```
🚀 Starting Ring to Open service...
📍 Location: Home (location_123)
📱 Found 3 device(s):
  - Front Door Intercom (intercom)
    🔔 This appears to be an intercom device
  - Back Door Camera (camera)
  - Garage Door Lock (lock)

📊 Summary: Found 3 total device(s), 1 intercom device(s)
✅ Ring to Open service is now running!
⏰ Auto-open hours: 08:00 - 22:00
🔓 Auto-open enabled: true
🔔 Listening for doorbell presses on all devices...
Press Ctrl+C to stop the service

🔔 Doorbell pressed on Front Door Intercom at 2:30:45 PM
📅 Current time: 2:30:45 PM
☀️ Daytime detected (08:00 - 22:00)
🚪 Auto-open enabled: true
🔓 Auto-opening door...
🔄 Attempting to open door...
✅ Successfully opened door via device: Front Door Intercom
```

## How It Works

1. **Device Discovery**: The service scans all your Ring devices to find intercoms and door controllers
2. **Event Listening**: Listens for doorbell press events from all devices
3. **Time Check**: When a doorbell is pressed, checks if it's within the configured daytime hours
4. **Door Control**: If it's daytime and auto-open is enabled, attempts to unlock/open the door
5. **Safety**: During nighttime hours, the door will not auto-open for security

## Troubleshooting

### No Devices Found
- Ensure your Ring Intercom is properly connected to your Ring account
- Check that your refresh token is correct
- Try running `npm run auth` again to get a fresh token

### Door Won't Open
- Verify your Ring Intercom has door control capabilities
- Check the device name contains "intercom" or similar keywords
- Ensure the device supports unlock/open operations
- Check the Ring app to confirm the device can be controlled remotely

### Time-based Issues
- Verify your timezone settings
- Check the `DOOR_OPEN_TIME` and `DOOR_CLOSE_TIME` format (HH:MM)
- Ensure `AUTO_OPEN_ENABLED=true` in your `.env` file

### Debug Mode
Enable debug logging by setting `DEBUG=true` in your `.env` file for more detailed output.

## Security Considerations

- **Time Restrictions**: The system only operates during configured daytime hours
- **Manual Override**: You can always disable auto-open by setting `AUTO_OPEN_ENABLED=false`
- **Local Operation**: The service runs locally on your machine
- **Token Security**: Keep your refresh token secure and don't share it

## Development

### Project Structure

```
ring-to-open/
├── ring-to-open.ts      # Main Ring to Open logic
├── example.ts           # Basic Ring API example
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── env.example          # Environment variables template
└── README.md           # This file
```

### Building

```bash
# Compile TypeScript
npm run build

# Run compiled version
node lib/ring-to-open.js
```

## License

This project is based on the `ring-client-api` package and follows the same licensing terms.

## Contributing

Feel free to submit issues and enhancement requests!
