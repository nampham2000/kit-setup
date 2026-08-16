# Blender MCP Server Addon / Script
# Listens on 127.0.0.1:9876 and executes commands inside Blender (bpy) context.

import bpy
import sys
import io
import json
import socket
import threading
import queue
import traceback

PORT = 9876
HOST = '127.0.0.1'

command_queue = queue.Queue()
response_map = {}

def get_scene_summary():
    data = {
        "version": bpy.app.version_string,
        "filepath": bpy.data.filepath,
        "objects": []
    }
    for obj in bpy.data.objects:
        info = {
            "name": obj.name,
            "type": obj.type,
            "location": [round(v, 4) for v in obj.location],
            "rotation_euler": [round(v, 4) for v in obj.rotation_euler],
            "scale": [round(v, 4) for v in obj.scale],
            "visible": obj.visible_get(),
        }
        if obj.type == 'MESH' and obj.data:
            info["vertices_count"] = len(obj.data.vertices)
            info["polygons_count"] = len(obj.data.polygons)
            info["materials"] = [m.name for m in obj.data.materials if m]
        data["objects"].append(info)
    return data

def process_command_in_main_thread():
    """Timer callback to safely execute commands on Blender's main thread."""
    while not command_queue.empty():
        req_id, action, code = command_queue.get()
        try:
            old_stdout = sys.stdout
            old_stderr = sys.stderr
            redirected_out = io.StringIO()
            redirected_err = io.StringIO()
            sys.stdout = redirected_out
            sys.stderr = redirected_err

            result = None
            if action == 'execute':
                exec_globals = {'bpy': bpy, 'sys': sys, 'json': json}
                exec(code, exec_globals)
                out_str = redirected_out.getvalue()
                err_str = redirected_err.getvalue()
                response_map[req_id] = {
                    "ok": True,
                    "stdout": out_str,
                    "stderr": err_str,
                    "result": out_str.strip() or "Execution successful"
                }
            elif action == 'eval':
                exec_globals = {'bpy': bpy, 'sys': sys, 'json': json}
                eval_res = eval(code, exec_globals)
                response_map[req_id] = {
                    "ok": True,
                    "result": eval_res
                }
            elif action == 'scene_info':
                response_map[req_id] = {
                    "ok": True,
                    "result": get_scene_summary()
                }
            elif action == 'ping':
                response_map[req_id] = {
                    "ok": True,
                    "version": bpy.app.version_string,
                    "result": "pong"
                }
            else:
                response_map[req_id] = {
                    "ok": False,
                    "error": f"Unknown action: {action}"
                }
        except Exception as e:
            response_map[req_id] = {
                "ok": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    return 0.05  # Run every 50ms

def handle_client(conn):
    try:
        data = conn.recv(65536).decode('utf-8')
        if not data:
            return
        try:
            req = json.loads(data)
        except json.JSONDecodeError as err:
            conn.sendall(json.dumps({"ok": False, "error": f"Invalid JSON: {str(err)}"}).encode('utf-8'))
            return

        req_id = req.get('id', 'req_1')
        action = req.get('action', 'execute')
        code = req.get('code', '')

        command_queue.put((req_id, action, code))

        # Wait for response from main thread
        import time
        start_time = time.time()
        while req_id not in response_map and (time.time() - start_time) < 30.0:
            time.sleep(0.01)

        resp = response_map.pop(req_id, {"ok": False, "error": "Timeout waiting for main thread execution"})
        conn.sendall(json.dumps(resp).encode('utf-8'))
    except Exception as e:
        try:
            conn.sendall(json.dumps({"ok": False, "error": str(e)}).encode('utf-8'))
        except Exception:
            pass
    finally:
        conn.close()

def start_socket_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((HOST, PORT))
        server.listen(5)
        print(f"[Blender-MCP] Server listening on {HOST}:{PORT}")
        while True:
            conn, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(conn,), daemon=True)
            t.start()
    except Exception as e:
        print(f"[Blender-MCP] Socket server error: {e}")
    finally:
        server.close()

def register():
    bpy.app.timers.register(process_command_in_main_thread)
    t = threading.Thread(target=start_socket_server, daemon=True)
    t.start()

if __name__ == "__main__":
    register()
    print(f"[Blender-MCP] Addon initialized on Blender {bpy.app.version_string} (port {PORT})")
