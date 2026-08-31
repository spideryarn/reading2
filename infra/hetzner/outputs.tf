output "ipv4" {
  value = hcloud_server.box.ipv4_address
}

output "ipv6" {
  value = hcloud_server.box.ipv6_address
}

output "ssh" {
  value = "ssh ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "mosh" {
  value = "mosh ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "vnc_tunnel" {
  description = "Run this locally, then open http://localhost:6080/vnc.html"
  value       = "ssh -L 6080:localhost:6080 ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "monthly_cost_note" {
  value = "CX53 EUR 29.49 + volume EUR ${format("%.2f", var.volume_size_gb * 0.044)} + IPv4 ~EUR 0.60, all NET. Add 20% UK VAT."
}
