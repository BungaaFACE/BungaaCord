sudo apt install coturn
sudo cp ./turnserver.conf /etc/turnserver.conf

sudo systemctl enable --now coturn.service

sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 63000:65535/udp
sudo ufw allow out 3478/udp
sudo ufw allow out 3478/tcp
sudo ufw allow out 63000:65535/udp
sudo ufw disable && sudo ufw enable