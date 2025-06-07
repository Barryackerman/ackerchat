import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import uuid
import base64

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = 'secret!'
app.config['TEMPLATES_AUTO_RELOAD'] = True  # auto-reload on change
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Map session_id to socket IDs (max 2)
session_peers = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

@socketio.on('create_session')
def handle_create():
    session_id = str(uuid.uuid4())[:6].upper()
    join_room(session_id)
    session_peers[session_id] = [request.sid]
    emit('session_created', session_id)

@socketio.on('join_session')
def handle_join(data):
    session_id = data.get('session_id')
    if session_id in session_peers and len(session_peers[session_id]) < 2:
        join_room(session_id)
        session_peers[session_id].append(request.sid)
        emit('session_joined', session_id)
        emit('peer_ready', room=session_id)
    else:
        emit('error', 'Session full or invalid.')

@socketio.on('send_message')
def handle_message(data):
    session_id = data.get('session_id')
    msg = data.get('message')
    emit('receive_message', msg, room=session_id, include_self=False)

@socketio.on('send_file')
def handle_file(data):
    session_id = data.get('session_id')
    filename = data.get('filename')
    filedata = base64.b64decode(data.get('file'))
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    with open(file_path, 'wb') as f:
        f.write(filedata)
    file_url = f'/uploads/{filename}'
    emit('receive_file', {'filename': filename, 'url': file_url}, room=session_id, include_self=False)

@socketio.on('signal')
def handle_signal(data):
    session_id = data.get('session_id')
    signal_data = data.get('data')
    emit('signal', {'data': signal_data}, room=session_id, include_self=False)

@socketio.on('disconnect')
def handle_disconnect():
    for session_id, sids in list(session_peers.items()):
        if request.sid in sids:
            sids.remove(request.sid)
            leave_room(session_id)
            if not sids:
                del session_peers[session_id]
            break

if __name__ == '__main__':
    print("✅ ACKERCHAT running on http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
