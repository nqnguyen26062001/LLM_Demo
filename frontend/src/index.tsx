import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { GoogleOAuthProvider } from '@react-oauth/google'
const client_id = "208078486894-g7m5luf3honjnavgbthk7c07mgeq35ps.apps.googleusercontent.com";
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
<React.StrictMode>
    {/* <GoogleOAuthProvider clientId={client_id} > */}
        <App />
    {/* </GoogleOAuthProvider> */}
</React.StrictMode>
    );