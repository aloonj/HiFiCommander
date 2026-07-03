import { useEffect, useRef, useState } from 'react';

export function useDlnaSocket() {
  const [devices, setDevices] = useState({ servers: [], renderers: [] });
  const [queueStates, setQueueStates] = useState({}); // rendererUdn -> queue state
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let socket;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'devices') {
          setDevices(message.payload);
        } else if (message.type === 'queue-state') {
          setQueueStates((prev) => ({ ...prev, [message.payload.rendererUdn]: message.payload }));
        }
      };

      socket.onclose = () => {
        if (!cancelled) setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);

  return { devices, queueStates };
}
