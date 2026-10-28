<?php

namespace App\Http\Controllers;

use App\Models\LaunchSubscriber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LaunchSubscriberController extends Controller
{
    /** Public "notify me at launch" signup. Same reply for new and existing addresses. */
    public function store(Request $request): JsonResponse
    {
        $message = "Thank you. We'll email you as soon as we open.";

        // Bots fill the hidden "website" field; accept quietly and store nothing.
        if (filled($request->input('website'))) {
            return response()->json(['message' => $message]);
        }

        $data = $request->validate(['email' => ['required', 'string', 'email:rfc', 'max:255']]);
        LaunchSubscriber::firstOrCreate(
            ['email' => strtolower(trim($data['email']))],
            ['source' => 'coming_soon', 'ip_address' => $request->ip()],
        );

        return response()->json(['message' => $message]);
    }

    /** For the owner: who is waiting for launch. */
    public function index(Request $request): JsonResponse
    {
        $subscribers = LaunchSubscriber::query()->latest()->paginate(50);

        return response()->json([
            'data' => $subscribers->getCollection()->map(fn (LaunchSubscriber $subscriber) => [
                'id' => $subscriber->id,
                'email' => $subscriber->email,
                'source' => $subscriber->source,
                'created_at' => $subscriber->created_at?->toIso8601String(),
            ]),
            'meta' => ['total' => $subscribers->total(), 'current_page' => $subscribers->currentPage(), 'last_page' => $subscribers->lastPage()],
        ]);
    }
}
