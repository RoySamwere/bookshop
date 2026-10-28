<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ config('app.name') }} API</title>
        <link rel="icon" type="image/png" href="/favicon.png">
        <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #13254a; font-family: system-ui, sans-serif; text-align: center; }
            img { width: min(320px, 80vw); height: auto; }
            p { margin: 16px 0 0; font-size: 14px; color: #5b6b8a; }
        </style>
    </head>
    <body>
        <main>
            <img src="/logo.png" alt="{{ config('app.name') }}">
            <p>The {{ config('app.name') }} API is running.</p>
        </main>
    </body>
</html>
