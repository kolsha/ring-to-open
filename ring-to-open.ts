import { RingApi, RingIntercom } from "ring-client-api";
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// Path to the persistent token file inside the Docker volume
const TOKEN_FILE = process.env.TOKEN_FILE || "/data/ring_refresh_token";

async function readPersistedToken(): Promise<string | null> {
  try {
    const token = await readFileAsync(TOKEN_FILE, "utf-8");
    return token.trim() || null;
  } catch {
    return null;
  }
}

async function persistToken(token: string): Promise<void> {
  await writeFileAsync(TOKEN_FILE, token, "utf-8");
}

interface DoorConfig {
  openTime: string; // Format: "HH:MM" (e.g., "08:00")
  closeTime: string; // Format: "HH:MM" (e.g., "22:00")
  autoOpenEnabled: boolean;
  doorDeviceId?: string; // Optional: specific door device ID
}

interface RingToOpenConfig {
  refreshToken: string;
  doorConfig: DoorConfig;
  debug?: boolean;
}

class RingToOpen {
  private ringApi: RingApi;
  private config: RingToOpenConfig;
  private isRunning: boolean = false;

  constructor(config: RingToOpenConfig) {
    this.config = config;
    this.ringApi = new RingApi({
      refreshToken: config.refreshToken,
      debug: config.debug || false,
    });
  }

  /**
   * Check if current time is within daytime hours
   */
  private isDaytime(): boolean {
    if (!this.config.doorConfig.autoOpenEnabled) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const [openHour, openMinute] = this.config.doorConfig.openTime.split(':').map(Number);
    const [closeHour, closeMinute] = this.config.doorConfig.closeTime.split(':').map(Number);
    
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;
    
    // Handle overnight periods (e.g., 22:00 to 08:00)
    if (closeTimeMinutes < openTimeMinutes) {
      return currentTime >= openTimeMinutes || currentTime <= closeTimeMinutes;
    } else {
      return currentTime >= openTimeMinutes && currentTime <= closeTimeMinutes;
    }
  }

  /**
   * Handle doorbell press events
   */
  private async handleDoorbellPress(intercom: RingIntercom): Promise<void> {
    const now = new Date();
    console.log(`\n🔔 Doorbell pressed on ${intercom.name} at ${now.toLocaleString()}`);
    console.log(`📅 Current time: ${now.toLocaleTimeString()}`);
    
    if (this.isDaytime()) {
      console.log(`☀️ Daytime detected (${this.config.doorConfig.openTime} - ${this.config.doorConfig.closeTime})`);
      console.log(`🚪 Auto-open enabled: ${this.config.doorConfig.autoOpenEnabled}`);
      
      if (this.config.doorConfig.autoOpenEnabled) {
        console.log("🔓 Auto-opening door...");
        const response = await intercom.unlock();
        console.log(response);
      } else {
        console.log("⚠️ Auto-open is disabled in configuration");
      }
    } else {
      console.log("🌙 Nighttime - door will not auto-open");
    }
  }

  private onRefreshTokenUpdated() {
    this.ringApi.onRefreshTokenUpdated.subscribe(
      async ({ newRefreshToken }: { newRefreshToken: string; oldRefreshToken?: string }) => {
        console.log("🔄 Refresh Token Updated");
        try {
          await persistToken(newRefreshToken);
          console.log(`✅ Persisted new refresh token to ${TOKEN_FILE}`);
        } catch (error) {
          console.error("❌ Failed to persist refresh token:", error);
        }
      }
    );
  }

  /**
   * Start listening for doorbell events
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️ Ring to Open is already running");
      return;
    }
   

    try {
      console.log("🚀 Starting Ring to Open service...");
      this.onRefreshTokenUpdated();

      // Get all locations and devices
      const locations = await this.ringApi.getLocations();

      // Set up doorbell press listeners for all devices
      for (const location of locations) {
        const intercoms = await location.intercoms;
        console.log(`\n📍 Location: ${location.name} (${location.id})`);
        console.log(`📱 Found ${intercoms.length} intercom(s):`);
        
        for (const intercom of intercoms) {
          console.log(`  - ${intercom.name} (${intercom.deviceType}), id='${intercom.id}'`);
          console.log(`    📊 Device status: ${intercom.isOffline ? 'Offline' : 'Online'}`);
          console.log(`    🔋 Battery level: ${intercom.batteryLevel !== null ? `${intercom.batteryLevel}%` : 'Unknown'}`);
          
          // Subscribe to ding events for this intercom
          try {
            await intercom.subscribeToDingEvents();
            console.log(`    ✅ Subscribed to ding events for ${intercom.name}`);
          } catch (error) {
            console.log(`    ⚠️ Failed to subscribe to ding events for ${intercom.name}:`, error);
          }
          
          // Set up the ding event listener
          intercom.onDing.subscribe(async () => {
            console.log(`🔔 Ding event received for ${intercom.name}!`);
            await this.handleDoorbellPress(intercom);
          });
          
          // Also listen for data updates to debug connection
          intercom.onData.subscribe((data) => {
            if (this.config.debug) {
              console.log(`📡 Data update for ${intercom.name}:`, data);
            }
          });
        }
      }

      this.isRunning = true;
      console.log("✅ Ring to Open service is now running!");
      console.log(`⏰ Auto-open hours: ${this.config.doorConfig.openTime} - ${this.config.doorConfig.closeTime}`);
      console.log(`🔓 Auto-open enabled: ${this.config.doorConfig.autoOpenEnabled}`);
      console.log("🔔 Listening for doorbell presses on all devices...");
      console.log("Press Ctrl+C to stop the service");

    } catch (error) {
      console.error("❌ Failed to start Ring to Open service:", error);
      throw error;
    }
  }

  /**
   * Test door unlock functionality
   */
  public async testDoorUnlock(intercomName?: string): Promise<void> {
    try {
      const locations = await this.ringApi.getLocations();
      
      for (const location of locations) {
        const intercoms = await location.intercoms;
        
        for (const intercom of intercoms) {
          if (intercomName && intercom.name !== intercomName) {
            continue;
          }
          
          console.log(`🧪 Testing door unlock for ${intercom.name}...`);
          
          try {
            const response = await intercom.unlock();
            console.log(`✅ Successfully unlocked door via ${intercom.name}:`, response);
          } catch (error) {
            console.log(`❌ Failed to unlock door via ${intercom.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error during door unlock test:", error);
    }
  }

  /**
   * Stop the service
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    console.log("🛑 Ring to Open service stopped");
    
    // Unsubscribe from ding events for all intercoms
    try {
      const locations = await this.ringApi.getLocations();
      for (const location of locations) {
        const intercoms = await location.intercoms;
        for (const intercom of intercoms) {
          try {
            await intercom.unsubscribeFromDingEvents();
            console.log(`    ✅ Unsubscribed from ding events for ${intercom.name}`);
          } catch (error) {
            console.log(`    ⚠️ Failed to unsubscribe from ding events for ${intercom.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.log("⚠️ Error during cleanup:", error);
    }
  }
}

// Main execution
async function main() {
  // Prefer the persisted token (updated by Ring API) over the env var (set by Coolify on deploy)
  const persistedToken = await readPersistedToken();
  if (persistedToken) {
    console.log(`🔑 Using persisted refresh token from ${TOKEN_FILE}`);
  } else {
    console.log("🔑 No persisted token found, using RING_REFRESH_TOKEN env var");
  }

  const config: RingToOpenConfig = {
    refreshToken: persistedToken ?? process.env.RING_REFRESH_TOKEN!,
    doorConfig: {
      openTime: process.env.DOOR_OPEN_TIME || "08:00",
      closeTime: process.env.DOOR_CLOSE_TIME || "22:00", 
      autoOpenEnabled: process.env.AUTO_OPEN_ENABLED === "true",
      doorDeviceId: process.env.DOOR_DEVICE_ID,
    },
    debug: process.env.DEBUG === "true",
  };

  // Validate configuration
  if (!config.refreshToken) {
    console.error("❌ RING_REFRESH_TOKEN is required in .env file");
    console.log("💡 Run 'npm run auth' to get your refresh token");
    // Wait 5 minutes without consuming CPU
    await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
    process.exit(1);
  }

  const ringToOpen = new RingToOpen(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n🛑 Received SIGINT, shutting down gracefully...");
    await ringToOpen.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
    await ringToOpen.stop();
    process.exit(0);
  });

  try {
    await ringToOpen.start();
  } catch (error) {
    console.error("❌ Failed to start Ring to Open:", error);
    process.exit(1);
  }
}

// Run the application
if (require.main === module) {
  main().catch(console.error);
}

export { RingToOpen, RingToOpenConfig, DoorConfig }; 