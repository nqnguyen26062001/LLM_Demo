import React, { useState, useRef, useEffect } from 'react';

type Message = {
  sender: 'You' | 'AI';
  text: string;
};

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
    const [latitude, setLatitude] = useState(0);
  const [longitude, setLongitude] = useState(0);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
// const getLocationAndSendToBackend = () => {
//     if (navigator.geolocation) {
//         navigator.geolocation.getCurrentPosition(
//             (position) => {
//                 setLatitude( position.coords.latitude);
//                 setLongitude( position.coords.longitude);

//                 console.log(`Vĩ độ: ${latitude}, Kinh độ: ${longitude}`);
//             },
//             (error) => {
//                 // Xử lý lỗi nếu người dùng từ chối cấp quyền hoặc có vấn đề khác
//                 switch (error.code) {
//                     case error.PERMISSION_DENIED:
//                         console.error("Người dùng đã từ chối yêu cầu định vị.");
//                         alert("Vui lòng cấp quyền định vị để sử dụng tính năng này.");
//                         break;
//                     case error.POSITION_UNAVAILABLE:
//                         console.error("Thông tin vị trí không khả dụng.");
//                         alert("Không thể xác định vị trí của bạn lúc này.");
//                         break;
//                     case error.TIMEOUT:
//                         console.error("Hết thời gian chờ khi lấy vị trí.");
//                         alert("Thời gian lấy vị trí quá lâu.");
//                         break;
//                 }
//             },
//             {
//                 enableHighAccuracy: true, // Yêu cầu độ chính xác cao
//                 timeout: 5000,           // Thời gian chờ tối đa 5 giây
//                 maximumAge: 0            // Không dùng cache vị trí cũ
//             }
//         );
//     } else {
//         alert("Trình duyệt của bạn không hỗ trợ Geolocation.");
//     }
// }

  useEffect(() => {
    scrollToBottom();
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLatitude( position.coords.latitude);
                setLongitude( position.coords.longitude);

                console.log(`Vĩ độ: ${latitude}, Kinh độ: ${longitude}`);
            },
            (error) => {
                // Xử lý lỗi nếu người dùng từ chối cấp quyền hoặc có vấn đề khác
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        console.error("Người dùng đã từ chối yêu cầu định vị.");
                        alert("Vui lòng cấp quyền định vị để sử dụng tính năng này.");
                        break;
                    case error.POSITION_UNAVAILABLE:
                        console.error("Thông tin vị trí không khả dụng.");
                        alert("Không thể xác định vị trí của bạn lúc này.");
                        break;
                    case error.TIMEOUT:
                        console.error("Hết thời gian chờ khi lấy vị trí.");
                        alert("Thời gian lấy vị trí quá lâu.");
                        break;
                }
            },
            {
                enableHighAccuracy: true, // Yêu cầu độ chính xác cao
                timeout: 5000,           // Thời gian chờ tối đa 5 giây
                maximumAge: 0            // Không dùng cache vị trí cũ
            }
        );
    } else {
        alert("Trình duyệt của bạn không hỗ trợ Geolocation.");
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    setMessages(prev => [...prev, { sender: 'You', text: input }]);
    const userMessage = input;
    setInput('');

    try {
      const res = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_message: userMessage , lat : latitude ,  lon: longitude  }),
      });
      const data = await res.json();
      console.log(data);
      if (res.ok) {
        setMessages(prev => [...prev, { sender: 'AI', text: data.message }]);
      } else {
        setMessages(prev => [...prev, { sender: 'AI', text: 'Lỗi từ server' }]);
      }
    } catch {
      setMessages(prev => [...prev, { sender: 'AI', text: 'Không thể kết nối' }]);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: '20px auto', padding: '10px' }}>
      <h2>Chat with AI</h2>
      <div
        style={{
          border: '1px solid #ccc',
          height: '400px',
          overflowY: 'auto',
          padding: '10px',
          marginBottom: '10px'
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <strong>{m.sender}:</strong> {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex' }}>
        <input
          style={{ flexGrow: 1, padding: '8px' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message"
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button onClick={()=>handleSend()} style={{ marginLeft: '10px', padding: '8px 16px' }}>Send</button>
      </div>
    </div>
  );
};

export default Chat;