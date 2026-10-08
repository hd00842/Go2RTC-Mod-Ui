# go2rtc — Server Stream Camera & NVR (Bản tùy biến bảo mật nâng cao)

> Dự án dựa trên mã nguồn mở [go2rtc](https://github.com/AlexxIT/go2rtc), được tùy biến và bổ sung: giao diện NVR quản lý tập trung, UI cấu hình camera thân thiện không bao giờ để lộ mật khẩu, cơ chế lưu mật khẩu mã hóa (secrets vault) và bắt buộc đăng nhập với mọi truy cập.

## 1. Tổng quan

go2rtc là server stream camera hiệu năng cao, hỗ trợ RTSP, RTMP, WebRTC, HLS, MJPEG, ONVIF, FFmpeg... Bản tùy biến này đóng gói thành một "server NVR gia đình" hoàn chỉnh:

- Xem đồng thời nhiều camera trên một màn hình (lưới 1x1 đến 4x4).
- Thêm / sửa / xóa camera bằng giao diện đồ họa — không cần sửa YAML, không lộ mật khẩu.
- Toàn bộ mật khẩu được mã hóa trong một file duy nhất; muốn xem phải có tài khoản admin.
- Bắt buộc đăng nhập (trang đăng nhập riêng + phiên cookie) với mọi truy cập web và API.

## 2. Tính năng nổi bật

### 2.1. Bảo mật truy cập
- Trang đăng nhập tùy biến (tài khoản + mật khẩu) cho toàn bộ hệ thống web.
- Phiên đăng nhập duy trì bằng cookie `go2rtc_session` (HttpOnly, SameSite=Lax, tự hết hạn sau 12 giờ).
- HTTP Basic Auth vẫn hoạt động song song cho client API (curl, Home Assistant...).
- `local_auth: true`: yêu cầu xác thực cả với kết nối từ localhost.
- Nút Logout ở màn hình NVR và màn hình Config.
- Đổi mật khẩu admin ngay trên giao diện; hệ thống tự khởi động lại để áp dụng.

### 2.2. Kho mật khẩu mã hóa (Secrets Vault)
- Mọi mật khẩu (camera + admin) nằm trong một file `config/secrets.yaml`, mã hóa AES-256-GCM.
- Khóa giải mã đặt tại `config/secrets.key` (quyền 0600).
- `config/go2rtc.yaml` không chứa mật khẩu thật — chỉ còn tham chiếu dạng `${PASS_...}`.
- Lần khởi động đầu tiên, mật khẩu plaintext trong config cũ được tự động migrate vào vault.
- Xem mật khẩu: chỉ khi đã đăng nhập admin (qua UI hoặc API `reveal=1`).

### 2.3. UI cấu hình thân thiện
- Thêm camera: chọn protocol (RTSP/RTMP/HTTP/ONVIF/FFmpeg/file/exec), nhập host, port, stream path, user, password.
- Stream path được giữ nguyên khi đổi protocol (kể cả `?subtype=...` của ONVIF).
- Mật khẩu luôn hiển thị dạng dấu chấm; bấm vào để xem tạm thời 5 giây.
- Ký tự đặc biệt trong mật khẩu (@, :) được xử lý đúng, không còn lỗi URL-encode.
- Chế độ Raw YAML cho người dùng nâng cao.

## 3. Cấu trúc thư mục

```
go2rtc-master/
├── main.go                  # Điểm vào chương trình, đăng ký module
├── docker/Dockerfile        # Build image Docker (golang alpine + ffmpeg)
├── config/                  # Thư mục config (mount vào /config của container)
│   ├── go2rtc.yaml          # Config chính (mật khẩu thay bằng ${...})
│   ├── secrets.yaml         # Vault mật khẩu mã hóa AES-256-GCM
│   ├── secrets.key          # Khóa master giải mã vault (0600)
│   └── admin_password.txt   # Receipt tài khoản admin (0600)
├── internal/
│   ├── api/                 # HTTP API + middleware auth + login/logout
│   ├── app/                 # Config, log, vault, migration secrets
│   ├── secrets/             # API quản lý secrets (api/secrets)
│   ├── onvif/, rtsp/, webrtc/, hls/, mjpeg/...  # Module stream
│   └── streams/             # Quản lý stream
├── pkg/                     # Thư viện dùng chung (rtsp, onvif, creds...)
└── www/                     # Giao diện web (go:embed vào binary)
    ├── index.html           # Trang đích
    ├── nvr.html             # Màn hình NVR chính (xem nhiều camera)
    ├── config.html          # Màn hình cấu hình đồ họa
    ├── login.html           # Trang đăng nhập
    └── ...
```

## 4. Cài đặt bằng Docker

### 4.1. Yêu cầu
- Docker Desktop (macOS/Windows) hoặc Docker Engine (Linux).
- Các camera cùng mạng LAN với máy chạy Docker.

### 4.2. Build image
```bash
cd /path/to/go2rtc-master
docker build -t go2rtc:local -f docker/Dockerfile .
```
Build gồm 2 giai đoạn: compile binary go2rtc (golang:1.25-alpine), sau đó đóng gói vào python:3.13-alpine kèm ffmpeg, tini.

### 4.3. Chạy container
```bash
docker run -d --name go2rtc --restart=unless-stopped \
  -p 1984:1984 \
  -p 8554:8554 \
  -p 8555:8555 -p 8555:8555/udp \
  -v /path/to/go2rtc-master/config:/config \
  go2rtc:local
```

Bảng port:

| Port | Công dụng |
|---|---|
| 1984 | HTTP API + giao diện web (port chính) |
| 8554 | RTSP server (re-stream cho đầu ghi/NVR khác) |
| 8555 | WebRTC (TCP + UDP) |

### 4.4. Lần đầu khởi động
1. Mở `http://localhost:1984/` — trang đăng nhập hiện ra.
2. Lấy tài khoản admin ban đầu trong file `config/admin_password.txt`:
   - username: admin
   - password: chuỗi 12 ký tự tự sinh
3. Đăng nhập và đổi mật khẩu ngay (mục 6.3).
4. Mật khẩu plaintext cũ trong `go2rtc.yaml` (nếu có) được tự động chuyển vào vault và thay bằng tham chiếu `${...}`.

### 4.5. Lệnh quản lý thường dùng
```bash
docker ps --filter name=go2rtc          # xem trạng thái
docker logs -f go2rtc                   # xem log trực tiếp
docker restart go2rtc                   # khởi động lại
docker stop go2rtc && docker rm go2rtc  # xóa container (dữ liệu vẫn còn trong config/)
```

## 5. Cấu hình

### 5.1. File config chính `config/go2rtc.yaml`
Ví dụ sau khi đã migrate bảo mật:
```yaml
api:
    local_auth: true
    password: ${GO2RTC_ADMIN_PASS}
    username: admin
streams:
    Phòng Khách: rtsp://admin:${PASS_PH_NG_KH_CH}@192.168.1.249:554/h264/ch1/main/av_stream
    Sân T4: onvif://user:${PASS_S_N_T4}@192.168.1.4?subtype=MediaProfile00200
```
- Các tham chiếu `${TÊN}` được giải mã từ vault ngay khi nạp config.
- Không tự tay ghi mật khẩu plaintext vào đây — hãy dùng UI config hoặc API secrets để mật khẩu được mã hóa đúng cách.
- Mục `api`: `username` / `password` là tài khoản đăng nhập web; `local_auth: true` bắt buộc xác thực cả từ localhost.

### 5.2. Secrets Vault (kho mật khẩu mã hóa)

| File | Vai trò | Quyền |
|---|---|---|
| `config/secrets.yaml` | Chứa bản mã AES-256-GCM của mọi mật khẩu | 0600 |
| `config/secrets.key` | Khóa master 32 byte để giải mã | 0600 |
| `config/admin_password.txt` | Receipt mật khẩu admin (cập nhật mỗi lần đổi) | 0600 |

Nguyên lý hoạt động:
- Khi khởi động, module `internal/app` mở vault; nếu chưa có khóa thì tự sinh khóa mới.
- Mật khẩu plaintext còn sót trong `go2rtc.yaml` được tự động chuyển vào vault và thay bằng `${...}` (migration một lần).
- Mật khẩu mới thêm/sửa qua UI luôn được ghi vào vault trước, config chỉ nhận tham chiếu.
- Log và phản hồi API tự động che mọi secret thành `***`.

Bảng tên secret mặc định sau migration:

| Tên trong vault | Camera / mục đích |
|---|---|
| `GO2RTC_ADMIN_PASS` | Mật khẩu đăng nhập web admin |
| `PASS_PH_NG_KH_CH` | Camera Phòng Khách |
| `PASS_PH_NG_KH_CH_IMOU` | Camera Phòng Khách iMOU |
| `PASS_CAM_B_P` | Camera Cam Bếp |
| `PASS_TR_C_NH` | Camera Trước Nhà |
| `PASS_CAM_SAU_NH` | Camera Cam Sau Nhà |
| `PASS_S_N_T4` | Camera Sân T4 |

Sao lưu & khôi phục:
- Copy cả `secrets.yaml` + `secrets.key` là đủ khôi phục toàn bộ mật khẩu.
- Mất `secrets.key`: không thể giải mã mật khẩu cũ; xóa cả 2 file rồi khởi động lại để tạo vault mới (phải nhập lại mật khẩu camera).

## 6. Hướng dẫn sử dụng giao diện web

### 6.1. Đăng nhập
- Truy cập bất kỳ địa chỉ nào (`/`, `/nvr.html`, `/config.html`...) khi chưa đăng nhập đều hiện trang đăng nhập.
- Nhập sai tài khoản/mật khẩu: quay lại trang đăng nhập kèm thông báo "Sai tài khoản hoặc mật khẩu".
- Phiên đăng nhập giữ 12 giờ nhờ cookie HttpOnly; hết phiên phải đăng nhập lại.

### 6.2. Các màn hình chính

| Màn hình | Địa chỉ | Công dụng |
|---|---|---|
| Landing | `/index.html` | Trang đích, liên kết tới các màn hình |
| NVR | `/nvr.html` | Xem nhiều camera đồng thời (1x1 -> 4x4), fullscreen, logout |
| Config | `/config.html` | Quản lý camera, cấu hình chung, Raw YAML, đổi mật khẩu, logout |
| Đăng nhập | tự hiện khi chưa auth | Form tài khoản / mật khẩu |

### 6.3. Đổi mật khẩu admin
1. Vào `config.html` -> bấm nút **🔑 Password** trên thanh công cụ.
2. Nhập mật khẩu mới (tối thiểu 8 ký tự) và nhập lại để xác nhận.
3. Bấm **Change Password**: hệ thống ghi mật khẩu mới vào vault, cập nhật `admin_password.txt` và tự khởi động lại dịch vụ (khoảng 3-4 giây).
4. Đăng nhập lại bằng mật khẩu mới. Mọi phiên cũ bị hủy sau khi restart.

### 6.4. Logout
- `nvr.html`: nút icon cửa thoát ở góc phải thanh header.
- `config.html`: nút **🚪 Logout** trên thanh công cụ.
- Logout xóa cookie phiên ngay lập tức và đưa về trang đăng nhập.

### 6.5. Thêm / sửa camera
1. `config.html` -> **Add Camera**.
2. Điền: tên camera, protocol, host/IP, port, stream path, username, password.
   - ONVIF: stream path dạng `?subtype=MediaProfile00200`; giá trị path được giữ nguyên khi đổi protocol.
   - Mật khẩu có ký tự đặc biệt (`@`, `:`...) nhập bình thường, không cần encode.
3. Ô **Full URL** tự preview với mật khẩu đã che.
4. **Save Camera**: mật khẩu được đẩy vào vault mã hóa, config chỉ nhận tham chiếu `${...}`; bấm **Save & Restart** để áp dụng.
5. Xem lại mật khẩu camera: bấm dòng `••••••••` trên card camera (hiện 5 giây rồi tự ẩn).
6. Xóa camera: nút **Delete** trên card, có hộp thoại xác nhận.

## 7. Tham khảo HTTP API

Mọi API đều yêu cầu xác thực: cookie phiên (trình duyệt) hoặc Basic Auth (client).

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/login` | Đăng nhập bằng form username/password, nhận cookie phiên |
| POST/GET | `/api/logout` | Đăng xuất, xóa phiên |
| GET | `/api` | Thông tin server |
| GET | `/api/config` | Đọc config thô (YAML, mật khẩu đã dạng `${...}`) |
| POST/PATCH | `/api/config` | Ghi / merge config |
| POST | `/api/restart` | Khởi động lại dịch vụ |
| GET | `/api/secrets` | Liệt kê secret (luôn mask `********`) |
| GET | `/api/secrets?name=X&reveal=1` | Xem plaintext secret X (chỉ admin) |
| POST | `/api/secrets` | Thêm/cập nhật secret, body JSON `{"name","value"}` |
| DELETE | `/api/secrets?name=X` | Xóa secret (riêng mật khẩu admin bị chặn, 403) |
| GET | `/api/ws` | WebSocket cho màn hình NVR |
| GET | `/api/stream, /api/frame, /api/hls...` | Các luồng video (WebRTC, HLS, MP4, MJPEG) |

Ví dụ dùng curl:
```bash
# đăng nhập và lưu cookie
curl -c jar.txt -d 'username=admin&password=MATKHAU' http://localhost:1984/api/login
# liệt kê secret (mask)
curl -b jar.txt http://localhost:1984/api/secrets
# xem một mật khẩu camera
curl -b jar.txt 'http://localhost:1984/api/secrets?name=PASS_S_N_T4&reveal=1'
# hoặc dùng Basic Auth
curl -u admin:MATKHAU http://localhost:1984/api/secrets
```

## 8. Lưu ý bảo mật

1. **Bảo vệ 3 file sống còn**: `secrets.key`, `secrets.yaml`, `admin_password.txt` (đều quyền 0600). Ai nắm cả `secrets.key` + `secrets.yaml` sẽ giải mã được toàn bộ mật khẩu.
2. **Đổi mật khẩu admin mặc định ngay sau lần đăng nhập đầu tiên.**
3. `local_auth: true` chặn truy cập không xác thực kể cả từ localhost — không tắt nếu không hiểu rõ hậu quả.
4. Khi muốn phơi hệ thống ra internet: đặt sau reverse proxy có TLS (HTTPS); không publish trực tiếp các port 1984/8554/8555.
5. Mật khẩu tự động bị che thành `***` trong log và thông báo lỗi.
6. Cookie phiên HttpOnly + SameSite=Lax, hết hạn sau 12 giờ; bị hủy khi logout hoặc restart.
7. API secrets chỉ trả plaintext khi có `reveal=1` kèm phiên admin hợp lệ; không cho xóa mật khẩu admin (403).
8. Không commit thư mục `config/` lên git (chứa khóa và bản mã).

## 9. Phát triển & build lại

- Giao diện web trong `www/` được nhúng vào binary bằng `go:embed` => mỗi lần sửa `www/*.html, *.js, *.css` BẮT BUỘC build lại image:
```bash
docker stop go2rtc && docker rm go2rtc
docker build -t go2rtc:local -f docker/Dockerfile .
docker run -d --name go2rtc --restart=unless-stopped \
  -p 1984:1984 -p 8554:8554 -p 8555:8555 -p 8555:8555/udp \
  -v $(pwd)/config:/config go2rtc:local
```
- Code backend Go: `internal/...`, `pkg/...`.
  - Vault mã hóa: `internal/app/vault.go`
  - Migration secrets + bật auth: `internal/app/migrate.go`
  - Middleware auth + login/logout: `internal/api/api.go`
  - API secrets: `internal/secrets/secrets.go`
- Kiểm tra nhanh cú pháp JS của config.html: tách phần trong cặp thẻ script rồi chạy `node --check`.
- Sau khi restart container, nhớ refresh cứng trình duyệt (Cmd+Shift+R) để bỏ cache trang cũ.

## 10. Câu hỏi thường gặp (FAQ)

**Q: Quên mật khẩu admin thì làm sao?**
A: Mở file `config/admin_password.txt` — file này luôn được cập nhật mỗi lần đổi mật khẩu. Nếu mất file: dùng `secrets.key` để giải mã `secrets.yaml` offline; cách cuối cùng là xóa cả `secrets.yaml` + `secrets.key` rồi khởi động lại (hệ thống tạo vault và tài khoản admin mới, phải nhập lại mật khẩu camera).

**Q: Truy cập bị 401 hoặc cứ hiện trang đăng nhập?**
A: Chưa đăng nhập hoặc phiên hết hạn — đăng nhập lại. Nhập sai sẽ có thông báo "Sai tài khoản hoặc mật khẩu".

**Q: Đổi mật khẩu xong không đăng nhập được?**
A: Chờ khoảng 5 giây để dịch vụ restart xong; dùng mật khẩu mới; mật khẩu hiện hành luôn có trong `admin_password.txt`.

**Q: Thêm camera nhưng không có hình?**
A: Kiểm tra URL stream trong màn Config; đảm bảo camera cùng LAN với máy chạy Docker; xem log bằng `docker logs go2rtc`.

**Q: Đổi protocol bị mất Stream Path?**
A: Đã sửa ở bản này — path được giữ khi đổi protocol (kể cả `?subtype=...` của ONVIF). Nếu vẫn thấy lỗi cũ, refresh cứng trình duyệt (Cmd+Shift+R).

**Q: Mật khẩu có ký tự `@` bị lỗi?**
A: Đã sửa — UI không còn encode sai. Camera cũ lưu dạng `%40` thì mở Edit và nhập lại mật khẩu gốc.

**Q: Muốn xem lại mật khẩu một camera?**
A: Đăng nhập admin, vào `config.html`, bấm dòng `••••••••` trên card camera; hoặc gọi API `GET /api/secrets?name=TEN&reveal=1`.

## 11. Giấy phép

Mã nguồn gốc go2rtc phát hành theo giấy phép MIT. Bản tùy biến này kế thừa giấy phép đó cho phần mã nguồn mở; các phần bổ sung bảo mật (vault, login, UI) phục vụ sử dụng cá nhân.
