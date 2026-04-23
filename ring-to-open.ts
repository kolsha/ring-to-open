import { RingApi, RingIntercom } from "ring-client-api";
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import * as http from "http";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// Path to the persistent token file.
// /app is mounted as a persistent volume by Coolify, so this file survives redeployments.
const TOKEN_FILE = process.env.TOKEN_FILE || "/app/ring_refresh_token";

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
  httpPort?: number;
  apiSecret?: string;
}

class RingToOpen {
  private ringApi: RingApi;
  private config: RingToOpenConfig;
  private isRunning: boolean = false;
  private intercoms: RingIntercom[] = [];
  private httpServer: http.Server | null = null;

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
        this.intercoms.push(...intercoms);
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
      this.startHttpServer();
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
   * Unlock all (or a specific) intercom door
   */
  public async unlockDoor(intercomName?: string): Promise<{ success: boolean; unlocked: string[]; errors: string[] }> {
    const unlocked: string[] = [];
    const errors: string[] = [];

    const targets = intercomName
      ? this.intercoms.filter((ic) => ic.name === intercomName)
      : this.intercoms;

    if (targets.length === 0) {
      return { success: false, unlocked, errors: ["No matching intercom found"] };
    }

    for (const intercom of targets) {
      try {
        await intercom.unlock();
        console.log(`🔓 Unlocked door via HTTP request: ${intercom.name}`);
        unlocked.push(intercom.name);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to unlock ${intercom.name}: ${msg}`);
        errors.push(`${intercom.name}: ${msg}`);
      }
    }

    return { success: unlocked.length > 0, unlocked, errors };
  }

  /**
   * Start the HTTP server exposing the /unlock endpoint
   */
  private startHttpServer(): void {
    const port = this.config.httpPort ?? 3000;
    const secret = this.config.apiSecret;

    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (req.method === "POST" && url.pathname === "/unlock") {
        if (secret) {
          const authHeader = req.headers["x-api-key"];
          if (authHeader !== secret) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          let intercomName: string | undefined;
          try {
            if (body) intercomName = JSON.parse(body)?.intercom;
          } catch {
            // ignore malformed body — unlock all
          }

          const result = await this.unlockDoor(intercomName);
          res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", running: this.isRunning, intercoms: this.intercoms.map((ic) => ic.name) }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    this.httpServer.listen(port, () => {
      console.log(`🌐 HTTP server listening on port ${port}`);
      console.log(`   POST /unlock  — unlock door (requires X-Api-Key header if API_SECRET is set)`);
      console.log(`   GET  /health  — service health check`);
    });
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

    if (this.httpServer) {
      this.httpServer.close(() => console.log("🌐 HTTP server closed"));
      this.httpServer = null;
    }
    
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
    httpPort: process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 3000,
    apiSecret: process.env.API_SECRET,
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