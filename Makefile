include $(TOPDIR)/rules.mk

PKG_NAME:=luci-mod-haproxy
PKG_VERSION:=0.9.0
PKG_RELEASE:=1

LUCI_TITLE:=HAProxy SNI Passthrough Manager
LUCI_DEPENDS:=+haproxy +luci-base
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,luci-mod-haproxy))
