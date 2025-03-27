const WebSocket = require('ws');
const os = require('os');
const si = require('systeminformation');
const { exec } = require('child_process');

const wss = new WebSocket.Server({ port: 8090 });

// Only exclude critical system processes
const systemProcesses = [
    "System", "Registry", "Memory Compression", 
    "smss.exe", "csrss.exe", "wininit.exe", 
    "services.exe", "lsass.exe", "svchost.exe", "dwm.exe"
].map(p => p.toLowerCase());

async function getUserProcesses() {
    try {
        const processes = await si.processes();
        return processes.list
            .filter(p => 
                p.cpu > 0.1 &&  // Only show processes using CPU
                !systemProcesses.includes(p.name.toLowerCase()) // Skip critical system processes
            )
            .sort((a, b) => b.cpu - a.cpu) // Sort by CPU usage
            .map(p => ({ 
                name: p.name, 
                pid: p.pid, 
                cpu: p.cpu.toFixed(2) + "%" 
            }));
    } catch (error) {
        console.error("Error getting processes:", error);
        return [];
    }
}

async function getSystemUsage() {
    try {
        const [cpuLoad, memory, disk, tempData] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.cpuTemperature()
        ]);

        const GB = 1024 * 1024 * 1024; // 1 GB in bytes
        const userProcesses = await getUserProcesses();

        return {
            uptime: (os.uptime() / 60).toFixed(2) + " mins",
            cpu: {
                usage: cpuLoad.currentLoad.toFixed(2),
                temp: tempData.main ? tempData.main + "°C" : "N/A",
            },
            memory: {
                total: (memory.total / GB).toFixed(2) + " GB",
                used: (memory.used / GB).toFixed(2) + " GB",
                free: (memory.free / GB).toFixed(2) + " GB",
            },
            disk: {
                total: (disk[0].size / GB).toFixed(2) + " GB",
                used: (disk[0].used / GB).toFixed(2) + " GB",
                free: (disk[0].available / GB).toFixed(2) + " GB",
            },
            userProcesses,
        };
    } catch (error) {
        console.error("Error fetching system data:", error);
        return {
            uptime: "Error",
            cpu: { usage: "Error", temp: "Error" },
            memory: { total: "Error", used: "Error", free: "Error" },
            disk: { total: "Error", used: "Error", free: "Error" },
            userProcesses: []
        };
    }
}

wss.on('connection', (ws) => {
    console.log('New client connected');

    const sendData = async () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(await getSystemUsage()));
        }
    };

    const interval = setInterval(sendData, 2000); // Update every 2 seconds

    ws.on('message', (msg) => {
        try {
            const { action, pid } = JSON.parse(msg);
            if (action === 'terminate') {
                exec(`taskkill /F /PID ${pid}`, (err) => {
                    if (err) console.error(`Failed to terminate PID ${pid}:`, err);
                    else console.log(`Successfully terminated PID ${pid}`);
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        clearInterval(interval);
        console.log('Client disconnected');
    });
});

console.log('✅ WebSocket server running on ws://localhost:8090');