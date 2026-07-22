<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class VideoDownloadJob extends Model
{
    use HasFactory;

    protected $table = 'video_download_jobs';

    protected $fillable = [
        'user_id',
        'source_url',
        'platform',
        'title',
        'author',
        'thumbnail_url',
        'requested_format',
        'requested_quality',
        'format_id',
        'file_path',
        'file_name',
        'file_size',
        'duration',
        'progress',
        'status',
        'error_message',
        'expires_at'
    ];

    protected $casts = [
        'file_size' => 'integer',
        'duration' => 'integer',
        'progress' => 'integer',
        'expires_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime'
    ];

    /**
     * Scope lọc tác vụ thành công
     */
    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }

    /**
     * Scope lọc tác vụ đang chờ hoặc đang xử lý
     */
    public function scopePendingOrProcessing($query)
    {
        return $query->whereIn('status', ['pending', 'inspecting', 'ready', 'processing']);
    }

    /**
     * Scope lọc tác vụ đã hết hạn
     */
    public function scopeExpired($query)
    {
        return $query->where('status', 'expired')
            ->orWhere(function ($q) {
                $q->whereNotNull('expires_at')
                  ->where('expires_at', '<=', now());
            });
    }
}
